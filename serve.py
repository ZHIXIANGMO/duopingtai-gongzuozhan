# -*- coding: utf-8 -*-
"""内容矩阵控制台 - 本地服务

一个身份可以开多个平台账号，一个平台可以有多个身份。
想法进来，长出成稿，投到具体账号，回来数据。

零依赖：只用标准库。只监听 127.0.0.1。
"""

import base64
import csv
import json
import os
import re
import secrets
import shutil
import sys
import threading
import urllib.error
import urllib.request
import webbrowser
from datetime import date, datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, quote

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "数据")
DIRS = {
    "身份": os.path.join(DATA, "身份"),
    "账号": os.path.join(DATA, "账号"),
    "灵感": os.path.join(DATA, "灵感"),
    "选题": os.path.join(DATA, "选题"),
    "稿件": os.path.join(DATA, "稿件"),
}
PUB_CSV = os.path.join(DATA, "投放.csv")
ASSET_DIR = os.path.join(DATA, "素材")
SETTINGS = os.path.join(DATA, "设置.json")
LOCAL_CONF = os.path.join(ROOT, "本地配置.json")

PORT = 8777
WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"]

# 每个实体写回时的字段顺序，避免 diff 乱序
ORDER = {
    "身份": ["id", "名称", "头像", "一句话", "年龄", "生日",
           "定位", "领域", "读者", "语气", "创建"],
    "账号": ["id", "身份", "平台", "账号名", "粉丝基线", "状态", "书签适配器", "创建"],
    "灵感": ["id", "来源", "原话", "捕获", "关联身份", "状态"],
    "选题": ["id", "来自灵感", "标题候选", "正方", "反方", "我站", "我可能错在哪",
           "目标身份", "目标平台", "优先级", "状态", "创建"],
    "稿件": ["id", "选题", "身份", "版本", "阶段", "配图形式", "排版", "重做",
           "字数", "创建", "更新"],
}

# 四阶段流水线。顺序就是进度条的格子顺序，改这里，前端跟着变。
# 复盘不在这里：数据在数据页看，稿件只走到「发出去」为止。
STAGES = ["讨论", "正文", "配图", "排版"]
PLATFORMS = ["小红书", "公众号", "抖音", "B站"]
STAGE_LABEL = {
    "讨论": "选题与讨论",
    "正文": "正文",
    "配图": "配图",
    "排版": "排版与发布",
}
# 每个阶段对应的正文小节。退回去改正文，后面这些小节就要重做。
STAGE_SECTION = {"配图": "配图", "排版": "排版"}
# 旧稿件的「状态」映射到阶段。只在读的时候兜底，不动老文件。
LEGACY_STAGE = {"构思": "讨论", "初稿": "正文", "打磨": "正文", "待审": "正文",
                "待确认": "正文", "定稿": "排版", "复盘": "排版"}
# 配图形式：公众号图 / 小红书图 / 不配图。默认公众号。
IMAGE_MODES = ["公众号", "小红书", "不配图"]

LOG_CSV = os.path.join(DATA, "日志.csv")
LOG_FIELDS = ["时间", "日期", "类型", "对象", "动作", "备注"]

# 人设正文的小节，顺序固定。前端按这个渲染，写回时按这个重排。
PERSONA_SECTIONS = ["这个人是谁", "要传递什么", "说话方式", "模仿样例",
                    "写作习惯", "视觉与设计风格", "平台差异", "别做的事"]
# 人设的短字段，全部要填齐才算立住了
PERSONA_FIELDS = ["一句话", "年龄", "生日", "定位", "领域", "读者", "语气"]

PUB_FIELDS = ["id", "发布日", "标题", "稿件", "账号", "适配说明", "链接",
              "阅读", "点赞", "收藏", "评论", "涨粉", "更新于", "推广动作", "推广结果"]

# 选题的冲突四字段。缺一个就说明这个题还没硬起来。
CONFLICT_FIELDS = ["正方", "反方", "我站", "我可能错在哪"]
EMPTY_VALUES = ("", "待补", "无", "none", "None")


# ---------------------------------------------------------------- md 读写

def parse_md(path):
    """拆 frontmatter 与正文。只认扁平的 key: value。"""
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    meta, body = {}, text
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            for line in parts[1].strip().splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    meta[k.strip()] = v.strip().strip('"').strip("'")
            body = parts[2].lstrip("\r\n")
    return meta, body


def write_md(path, meta, body, kind):
    order = ORDER.get(kind, [])
    lines = ["---"]
    for k in order:
        if k in meta and str(meta[k]).strip() != "":
            val = meta[k]
            if k == "id" and not str(val).startswith('"'):
                val = '"%s"' % val
            lines.append("%s: %s" % (k, str(val).replace("\n", " ")))
    for k, v in meta.items():
        if k not in order and str(v).strip() != "":
            lines.append("%s: %s" % (k, str(v).replace("\n", " ")))
    lines.append("---")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n\n" + (body or ""))


def list_entity(kind):
    """读一个目录下的全部 md。读失败的不让整个页面崩。"""
    out = []
    d = DIRS.get(kind)
    if not d or not os.path.isdir(d):
        return out
    for name in sorted(os.listdir(d)):
        if not name.lower().endswith(".md"):
            continue
        path = os.path.join(d, name)
        try:
            meta, body = parse_md(path)
        except Exception as exc:
            out.append({"id": os.path.splitext(name)[0], "读取失败": str(exc), "正文": ""})
            continue
        item = dict(meta)
        item.setdefault("id", os.path.splitext(name)[0])
        item["正文"] = body
        item["文件"] = name
        out.append(item)
    return out


def save_entity(kind, item_id, fields=None, body=None):
    """按 id 找到文件写回。fields 里给空字符串就是清空该字段。"""
    d = DIRS.get(kind)
    if not d:
        raise ValueError("未知的类型：%s" % kind)
    path = os.path.join(d, "%s.md" % item_id)
    if not os.path.isfile(path):
        raise ValueError("找不到文件：%s" % path)

    meta, old_body = parse_md(path)
    if fields:
        for k, v in fields.items():
            if k in ("id", "正文", "文件"):
                continue
            meta[k] = "" if v is None else str(v)
    if kind == "稿件":
        meta["更新"] = date.today().isoformat()
        # 正文一改，已经做出来的阶段产物就对不上了，标待重做（不马上删，留着给人看）
        if body is not None and (body or "") != (old_body or ""):
            here = stage_of(meta)
            secs = sections_of(body)
            redo = redo_list(meta)
            for s in STAGES[STAGES.index(here):]:
                if s not in redo and has_product(meta, secs, s):
                    redo.append(s)
            if redo:
                meta["重做"] = ",".join(redo)
                append_log("正文", item_id, "改了正文",
                           "；".join(STAGE_LABEL.get(x, x) for x in redo) + " 待重做")
    snapshot(path, kind)
    write_md(path, meta, old_body if body is None else body, kind)

    fresh, fresh_body = parse_md(path)
    fresh["正文"] = fresh_body
    return fresh


# 写盘前先存一份旧文件，改坏了能捞回来。每份最多留 20 个版本。
SNAP_KEEP = 20


def snapshot(path, kind):
    stem = os.path.splitext(os.path.basename(path))[0]
    d = os.path.join(DATA, ".历史", kind)
    try:
        os.makedirs(d, exist_ok=True)
        shutil.copyfile(path, os.path.join(
            d, "%s.%s.md" % (stem, datetime.now().strftime("%Y%m%d-%H%M%S"))))
        old = sorted(n for n in os.listdir(d) if n.startswith(stem + "."))
        for n in old[:-SNAP_KEEP]:
            os.remove(os.path.join(d, n))
    except OSError:
        pass  # 备份失败不该挡住保存


def rewrite_section(body, section, text):
    """只替换一个小节，别的小节原样留着。缺这个小节就按固定顺序插进去。"""
    head, blocks = [], []
    for line in (body or "").splitlines():
        name = line[3:].strip() if line.startswith("## ") else None
        if name is not None and name in KNOWN_SECTIONS:
            blocks.append([name, []])
        elif blocks:
            blocks[-1][1].append(line)
        else:
            head.append(line)

    new_lines = text.strip().splitlines() if text.strip() else [""]
    hit = False
    for b in blocks:
        if b[0] == section:
            b[1] = new_lines
            hit = True
    if not hit:
        idx = len(blocks)
        if section in PERSONA_SECTIONS:
            want = PERSONA_SECTIONS.index(section)
            for i, b in enumerate(blocks):
                if b[0] in PERSONA_SECTIONS and PERSONA_SECTIONS.index(b[0]) > want:
                    idx = i
                    break
        blocks.insert(idx, [section, new_lines])

    parts = []
    lead = "\n".join(head).strip()
    if lead:
        parts.append(lead)
    for name, lines in blocks:
        chunk = "\n".join(lines).strip()
        parts.append("## " + name + ("\n\n" + chunk if chunk else ""))
    return "\n\n".join(parts) + "\n"


def flatten_heads(text):
    """小节内容里的 # 标题会被人设文件当成新小节，压成加粗行保住结构。"""
    out = []
    for line in str(text or "").splitlines():
        m = re.match(r"^\s{0,3}#{1,6}\s+(.*)$", line)
        out.append("**%s**" % m.group(1).strip() if m and m.group(1).strip() else line)
    return "\n".join(out)


def save_section(kind, item_id, section, text):
    """人设页按块编辑：一次只动一个小节。"""
    d = DIRS.get(kind)
    if not d:
        raise ValueError("未知的类型：%s" % kind)
    if not str(section or "").strip():
        raise ValueError("没说改哪一小节")
    path = os.path.join(d, "%s.md" % item_id)
    if not os.path.isfile(path):
        raise ValueError("找不到文件：%s" % path)

    meta, old_body = parse_md(path)
    if kind == "稿件":
        # 重新写了某一阶段的产物，这一格就不再是「待重做」了
        meta["更新"] = date.today().isoformat()
        redo = redo_list(meta)
        if str(section).strip() in redo:
            redo.remove(str(section).strip())
            meta["重做"] = ",".join(redo)
        # 改的是正文：后面做过的配图/排版就对不上了，跟 save_entity 一条规矩
        if str(section).strip() == "正文":
            before = sections_of(old_body).get("正文") or ""
            if text.strip() != before.strip():
                here = stage_of(meta)
                for s in STAGES[STAGES.index(here) + 1:]:
                    name = STAGE_SECTION.get(s)
                    if name and s not in redo and has_product(meta, sections_of(old_body), s):
                        redo.append(s)
                if redo:
                    meta["重做"] = ",".join(redo)
                    append_log("正文", item_id, "改了正文",
                               "；".join(STAGE_LABEL.get(x, x) for x in redo) + " 待重做")
        append_log("产物", item_id, "写了「%s」" % str(section).strip(), "")
    snapshot(path, kind)
    # 只有人设的小节是「## 标题」式排版，稿件的小节里 # 就是正经 Markdown 标题，别压
    content = flatten_heads(text) if kind == "身份" else text
    write_md(path, meta, rewrite_section(old_body, str(section).strip(), content), kind)

    fresh, fresh_body = parse_md(path)
    fresh["正文"] = fresh_body
    return fresh


# ---------------------------------------------------------------- 五阶段

# 正文里只有这些 ## 才算小节边界。别的一律当内容——
# 否则正文中间写一句「## 早上」，整篇文章就会被切成两半，还不报错。
KNOWN_SECTIONS = ("素材", "正文", "这版改了什么", "人工意见", "配图", "排版", "复盘",
                  "必须写进去的细节")


def sections_of(body):
    """把正文按 ## 切成 {小节名: 内容}。用来判断某个阶段的产物有没有做。"""
    out, cur, buf = {}, None, []
    for line in (body or "").splitlines():
        name = line[3:].strip() if line.startswith("## ") else None
        if name is not None and name in KNOWN_SECTIONS:
            if cur is not None:
                out[cur] = "\n".join(buf).strip()
            cur, buf = name, []
        elif cur is not None:
            buf.append(line)
        elif name is not None:
            # 开头就是未知的 ##，别丢，当内容留着
            buf.append(line)
    if cur is not None:
        out[cur] = "\n".join(buf).strip()
    return out


def has_product(meta, secs, stage):
    """这一格到底做没做过。
    配图和排版不靠小节记：配图写 `配图形式` 字段，排版写 `排版` 字段。
    只看 ## 小节的话，这两格永远是「没产物」，退回时也就永远不提示待重做。"""
    if stage == "配图":
        return bool(str(meta.get("配图形式") or "").strip()
                    or (secs.get("配图") or "").strip())
    if stage == "排版":
        return bool(str(meta.get("排版") or "").strip()
                    or (secs.get("排版") or "").strip())
    name = STAGE_SECTION.get(stage)
    return bool(name and (secs.get(name) or "").strip())


def stage_of(item):
    """读稿件的阶段。老文件可能写着旧名字（待审/复盘），按映射兜底，不动老文件。"""
    s = str(item.get("阶段") or "").strip()
    if s in STAGES:
        return s
    if s in LEGACY_STAGE:
        return LEGACY_STAGE[s]
    return LEGACY_STAGE.get(str(item.get("状态") or "").strip(), "讨论")


def redo_list(item):
    """标了待重做的阶段。逗号分号都认。"""
    raw = str(item.get("重做") or "").replace("，", ",").replace("、", ",")
    return [x.strip() for x in raw.split(",") if x.strip() in STAGES]


def archive_section(item_id, stage, text):
    """作废的产物不删，挪进 .历史/作废，以后想捞还能捞。"""
    d = os.path.join(DATA, ".历史", "作废")
    try:
        os.makedirs(d, exist_ok=True)
        name = "%s.%s.%s.md" % (item_id, stage, datetime.now().strftime("%Y%m%d-%H%M%S"))
        with open(os.path.join(d, name), "w", encoding="utf-8") as f:
            f.write("## %s\n\n%s\n" % (STAGE_SECTION.get(stage, stage), text))
        return os.path.join(".历史", "作废", name)
    except OSError:
        return ""


def advance_stage(kind, item_id, target, note=""):
    """把稿件推到某个阶段。

    往回走：这一段之后已经做出来的产物标「待重做」，内容先留着给人看。
    再往前走回到那一格：标过待重做的产物挪进 .历史/作废，小节清空，重新开。
    """
    if kind != "稿件":
        raise ValueError("只有稿件有阶段")
    target = str(target or "").strip()
    if target not in STAGES:
        raise ValueError("没有这个阶段：%s" % target)
    path = os.path.join(DIRS["稿件"], "%s.md" % item_id)
    if not os.path.isfile(path):
        raise ValueError("找不到稿件：%s" % item_id)

    meta, body = parse_md(path)
    cur = stage_of(meta)
    ci, ti = STAGES.index(cur), STAGES.index(target)
    redo = redo_list(meta)
    secs = sections_of(body)
    events = []

    if ti < ci:
        for s in STAGES[ti + 1:]:
            if s not in redo and has_product(meta, secs, s):
                redo.append(s)
        if redo:
            names = [STAGE_LABEL.get(x, x) for x in STAGES if x in redo]
            events.append("%s 待重做" % "、".join(names))
    elif ti > ci:
        for s in STAGES[ci:ti + 1]:
            if s not in redo:
                continue
            name = STAGE_SECTION.get(s)
            old = (secs.get(name) or "").strip() if name else ""
            if old:
                archive_section(item_id, s, old)
            if name:
                body = rewrite_section(body, name, "")
            # 配图和排版的产物记在字段上，重开时一起清掉，否则「重做」等于没做
            if s == "配图":
                meta.pop("配图形式", None)
            if s == "排版":
                meta.pop("排版", None)
            events.append("%s 作废重开" % STAGE_LABEL.get(s, s))
            redo.remove(s)
        skipped = [s for s in STAGES[ci + 1:ti] if s not in redo]
        if skipped:
            events.append("跳过 %s" % "、".join(skipped))

    meta["阶段"] = target
    meta["重做"] = ",".join(redo)
    meta["更新"] = date.today().isoformat()
    meta.pop("状态", None)  # 阶段接管了，旧的别留在文件里
    snapshot(path, "稿件")
    write_md(path, meta, body, "稿件")
    append_log("阶段", item_id, "%s → %s" % (cur, target),
               note or "；".join(events))

    fresh, fresh_body = parse_md(path)
    fresh["正文"] = fresh_body
    fresh["阶段"] = target
    return fresh


# ---------------------------------------------------------------- 开稿

DRAFT_TEMPLATE = """## 素材

## 正文

## 这版改了什么

v1：从选题 {topic} 开的新稿。

## 人工意见

## 配图

## 排版
"""


def next_id(kind, prefix):
    """按目录里已有的最大编号往下排，dr-001 之后是 dr-002。"""
    d = DIRS.get(kind)
    if not d:
        raise ValueError("未知的类型：%s" % kind)
    os.makedirs(d, exist_ok=True)
    nums = []
    for name in os.listdir(d):
        m = re.match(r"%s-(\d+)\.md$" % prefix, name)
        if m:
            nums.append(int(m.group(1)))
    return "%s-%03d" % (prefix, (max(nums) + 1) if nums else 1)


def new_entity(kind, payload):
    """页面上直接建一条，不用手动去写 md。只填空壳，内容还是得聊出来。"""
    today = date.today().isoformat()
    ident = str(payload.get("身份") or "").strip() or settings().get("身份") or ""

    if kind == "灵感":
        text = str(payload.get("原话") or "").strip()
        if not text:
            raise ValueError("先写一句原话")
        nid = next_id("灵感", "sp")
        meta = {"id": nid, "来源": str(payload.get("来源") or "").strip() or "随手记",
                "原话": text, "捕获": today, "关联身份": ident, "状态": "未孵化"}
        body = "## 当时的场景\n\n（待补：在哪听到的、当时在想什么。）\n"

    elif kind == "选题":
        title = str(payload.get("标题候选") or "").strip()
        if not title:
            raise ValueError("先给个标题")
        nid = next_id("选题", "tp")
        meta = {"id": nid, "来自灵感": str(payload.get("来自灵感") or "").strip(),
                "标题候选": title, "正方": "", "反方": "", "我站": "", "我可能错在哪": "",
                "目标身份": ident,
                "目标平台": str(payload.get("目标平台") or "").strip(),
                "优先级": "P1", "状态": "待定", "创建": today}
        body = "## 必须写进去的细节\n\n（待补：能撑住这个题的真实经历或数字。）\n"

    elif kind == "账号":
        name = str(payload.get("账号名") or "").strip()
        plat = str(payload.get("平台") or "").strip()
        if plat not in PLATFORMS:
            raise ValueError("平台只能是：%s" % " / ".join(PLATFORMS))
        if not name:
            raise ValueError("账号名要填")
        nid = next_id("账号", "acc")
        meta = {"id": nid, "身份": ident, "平台": plat, "账号名": name,
                "粉丝基线": 0, "状态": "正常", "书签适配器": "", "创建": today}
        body = "## 这个号的现状\n\n（待补：现在多少粉、主要发什么、最近什么问题。）\n"

    else:
        raise ValueError("建不了这种：%s" % kind)

    path = os.path.join(DIRS[kind], "%s.md" % nid)
    write_md(path, meta, body, kind)
    append_log("新建", nid, "建了一条%s" % kind, meta.get("原话") or meta.get("标题候选") or meta.get("账号名") or "")
    fresh, fresh_body = parse_md(path)
    fresh["正文"] = fresh_body
    return fresh


def new_draft(topic_id, ident_id=""):
    """从一条选题开一篇新稿，直接落在第一阶段「讨论」。"""
    topic_id = str(topic_id or "").strip()
    if not topic_id:
        raise ValueError("没说从哪条选题开")
    topic = None
    for t in list_entity("选题"):
        if t["id"] == topic_id:
            topic = t
            break
    if topic is None:
        raise ValueError("找不到选题：%s" % topic_id)

    if not ident_id:
        ident_id = (id_list(topic.get("目标身份")) or [settings().get("身份") or ""])[0]

    did = next_id("稿件", "dr")
    meta = {
        "id": did, "选题": topic_id, "身份": ident_id or "",
        "版本": "v1", "阶段": "讨论", "字数": 0,
        "创建": date.today().isoformat(), "更新": date.today().isoformat(),
    }
    path = os.path.join(DIRS["稿件"], "%s.md" % did)
    write_md(path, meta, DRAFT_TEMPLATE.format(topic=topic_id), "稿件")
    append_log("开稿", did, "从 %s 开稿" % topic_id,
               (topic.get("标题候选") or "").split("|")[0].strip())
    fresh, fresh_body = parse_md(path)
    fresh["正文"] = fresh_body
    return fresh


# ---------------------------------------------------------------- 素材文件

# 拖进来的附件就放 数据/素材/<稿号>/ 下，和 md 一样不进仓库。
ASSET_OK = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf",
            ".txt", ".md", ".docx", ".csv", ".html"}
ASSET_MAX = 20 * 1024 * 1024


def asset_dir(draft_id):
    safe = re.sub(r"[^0-9A-Za-z_-]", "", str(draft_id or ""))
    if not safe:
        raise ValueError("稿号不对：%r" % draft_id)
    return os.path.join(ASSET_DIR, safe)


def list_assets(draft_id):
    """列出这篇稿的附件。目录不存在就当没有，别报错。"""
    try:
        d = asset_dir(draft_id)
    except ValueError:
        return []
    if not os.path.isdir(d):
        return []
    out = []
    for name in sorted(os.listdir(d)):
        path = os.path.join(d, name)
        if not os.path.isfile(path):
            continue
        ext = os.path.splitext(name)[1].lower()
        out.append({
            "名字": name,
            "地址": "/数据/素材/%s/%s" % (os.path.basename(d), quote(name)),
            "大小": os.path.getsize(path),
            "是图": ext in {".png", ".jpg", ".jpeg", ".webp", ".gif"},
        })
    return out


def save_asset(draft_id, name, b64):
    """浏览器把文件读成 base64 传上来，这里落盘。"""
    raw = os.path.basename(str(name or "")).strip()
    raw = re.sub(r'[\\/:*?"<>|]', "_", raw)
    if not raw:
        raise ValueError("文件没名字")
    ext = os.path.splitext(raw)[1].lower()
    if ext not in ASSET_OK:
        raise ValueError("这个类型先不支持：%s" % (ext or "无扩展名"))
    try:
        blob = base64.b64decode(str(b64 or "").split(",")[-1], validate=False)
    except Exception:
        raise ValueError("文件内容解不开")
    if not blob:
        raise ValueError("文件是空的")
    if len(blob) > ASSET_MAX:
        raise ValueError("文件超过 20MB")

    d = asset_dir(draft_id)
    os.makedirs(d, exist_ok=True)
    base, i = raw, 1
    while os.path.exists(os.path.join(d, raw)):
        stem, ext2 = os.path.splitext(base)
        raw = "%s-%d%s" % (stem, i, ext2)
        i += 1
    with open(os.path.join(d, raw), "wb") as f:
        f.write(blob)
    return raw


# ---------------------------------------------------------------- 日志

def append_log(类型, 对象, 动作, 备注=""):
    """一条线一行，calendar 和首页都从这里读。"""
    now = datetime.now()
    row = {"时间": now.strftime("%Y-%m-%d %H:%M"), "日期": now.date().isoformat(),
           "类型": 类型, "对象": 对象, "动作": 动作,
           "备注": str(备注 or "").replace("\n", " ").strip()}
    fresh = not os.path.isfile(LOG_CSV)
    try:
        os.makedirs(DATA, exist_ok=True)
        with open(LOG_CSV, "a", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=LOG_FIELDS, extrasaction="ignore")
            if fresh:
                w.writeheader()
            w.writerow(row)
    except OSError:
        pass  # 日志写不进去不该挡住业务
    return row


def read_logs(limit=400):
    if not os.path.isfile(LOG_CSV):
        return []
    rows = []
    try:
        with open(LOG_CSV, "r", encoding="utf-8-sig", newline="") as f:
            for raw in csv.DictReader(f):
                if not (raw.get("时间") or "").strip():
                    continue
                rows.append(dict((k, (raw.get(k) or "").strip()) for k in LOG_FIELDS))
    except (OSError, csv.Error):
        return []
    rows.sort(key=lambda r: r["时间"], reverse=True)
    return rows[:limit]




# ---------------------------------------------------------------- 数字

def num(raw):
    """空、带千分位、带「万」都能吃。"""
    s = str(raw or "").strip().replace(",", "").replace("，", "")
    if not s:
        return 0
    try:
        return int(float(s))
    except ValueError:
        return 0


def days_since(raw):
    try:
        d = datetime.strptime(str(raw).strip(), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return 0
    return max((date.today() - d).days, 0)


def is_blank(v):
    return str(v if v is not None else "").strip() in EMPTY_VALUES


# ---------------------------------------------------------------- 投放

def read_pubs():
    if not os.path.isfile(PUB_CSV):
        return []
    rows = []
    with open(PUB_CSV, "r", encoding="utf-8-sig", newline="") as f:
        for raw in csv.DictReader(f):
            if not (raw.get("发布日") or "").strip():
                continue
            like = num(raw.get("点赞"))
            fav = num(raw.get("收藏"))
            cmt = num(raw.get("评论"))
            read = num(raw.get("阅读"))
            rows.append({
                "id": (raw.get("id") or "").strip(),
                "发布日": raw["发布日"].strip(),
                "标题": (raw.get("标题") or "").strip() or "未命名",
                "稿件": (raw.get("稿件") or "").strip(),
                "账号": (raw.get("账号") or "").strip(),
                "适配说明": (raw.get("适配说明") or "").strip(),
                "链接": (raw.get("链接") or "").strip(),
                "阅读": read,
                "点赞": like,
                "收藏": fav,
                "评论": cmt,
                "涨粉": num(raw.get("涨粉")),
                "互动": like + fav + cmt,
                "互动率": round((like + fav + cmt) * 100.0 / read, 2) if read else 0.0,
                "更新于": (raw.get("更新于") or "").strip(),
                "推广动作": (raw.get("推广动作") or "").strip(),
                "推广结果": (raw.get("推广结果") or "").strip(),
            })
    rows.sort(key=lambda r: (r["发布日"], r["标题"]), reverse=True)
    return rows


def write_pubs(rows):
    tmp = PUB_CSV + ".tmp"
    with open(tmp, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=PUB_FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
    os.replace(tmp, PUB_CSV)


def add_pub(payload):
    """书签脚本和手填表单都走这里。同一天同一稿件同一账号 = 覆盖，不重复。"""
    rows = read_pubs()
    acc = str(payload.get("账号") or "").strip()
    if not acc:
        raise ValueError("缺账号")

    day = str(payload.get("发布日") or "").strip() or date.today().isoformat()
    draft = str(payload.get("稿件") or "").strip()
    title = str(payload.get("标题") or "").strip()

    hit = None
    for r in rows:
        if r["账号"] == acc and r["发布日"] == day and (
                (draft and r["稿件"] == draft) or (title and r["标题"] == title)):
            hit = r
            break

    row = hit or {"id": "pb-%03d" % (len(rows) + 1), "发布日": day, "稿件": draft,
                  "账号": acc, "适配说明": "", "推广动作": "", "推广结果": ""}
    row["标题"] = title or row.get("标题") or "未命名"
    for k in ("阅读", "点赞", "收藏", "评论", "涨粉"):
        if payload.get(k) not in (None, ""):
            row[k] = num(payload.get(k))
    if payload.get("链接"):
        row["链接"] = str(payload["链接"]).strip()
    if payload.get("适配说明"):
        row["适配说明"] = str(payload["适配说明"]).strip()
    if payload.get("推广动作"):
        row["推广动作"] = str(payload["推广动作"]).strip()
    if payload.get("推广结果"):
        row["推广结果"] = str(payload["推广结果"]).strip()
    row["更新于"] = date.today().isoformat()

    if hit is None:
        rows.append(row)
    write_pubs(rows)
    return row


# ---------------------------------------------------------------- 设置

def load_json(path, default):
    if not os.path.isfile(path):
        return dict(default)
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            got = json.load(f)
        out = dict(default)
        out.update(got or {})
        return out
    except Exception:
        return dict(default)


def settings():
    return load_json(SETTINGS, {"每周目标": 5, "身份": "", "模型": {}})


def local_conf():
    return load_json(LOCAL_CONF, {"api_key": "", "代理": "", "接口": "", "模型名": ""})


def ensure_bookmark_token():
    """书签脚本要带一个本地令牌，防止别的网页偷偷往这里 POST。"""
    s = settings()
    if s.get("书签令牌"):
        return s["书签令牌"]
    token = secrets.token_hex(8)
    s["书签令牌"] = token
    with open(SETTINGS, "w", encoding="utf-8") as f:
        json.dump(s, f, ensure_ascii=False, indent=2)
    return token


# ---------------------------------------------------------------- 待办

def build_todos(state):
    """只放「不处理就卡住」的东西。按级别排：red 先。"""
    todos = []
    for t in state["选题"]:
        if t.get("状态") in ("已用", "废弃"):
            continue
        missing = [f for f in CONFLICT_FIELDS if is_blank(t.get(f))]
        if missing:
            todos.append({
                "级别": "red",
                "类型": "选题冲突不完整",
                "标题": "%s %s" % (t["id"], (t.get("标题候选") or "").split("|")[0].strip()),
                "说明": "缺：" + " / ".join(missing) + "。填不全就别往下走，AI 写出来是空的。",
                "目标": {"kind": "选题", "id": t["id"]},
            })

    for d in state["稿件"]:
        here = stage_of(d)
        redo = redo_list(d)
        if here == "正文":
            todos.append({
                "级别": "red",
                "类型": "正文等你过目",
                "标题": "%s %s" % (d["id"], d.get("选题") or ""),
                "说明": "正文写完了，等你改。改到能发就进配图。",
                "目标": {"kind": "稿件", "id": d["id"]},
            })
        elif redo:
            todos.append({
                "级别": "red",
                "类型": "阶段产物待重做",
                "标题": "%s %s" % (d["id"], d.get("选题") or ""),
                "说明": "退回改过正文，%s 要重做。" % "、".join(
                    x for x in STAGES if x in redo),
                "目标": {"kind": "稿件", "id": d["id"]},
            })

    for sp in state["灵感"]:
        if sp.get("状态") == "未孵化":
            age = days_since(sp.get("捕获"))
            if age >= 3:
                todos.append({
                    "级别": "gray",
                    "类型": "灵感搁着没动",
                    "标题": sp.get("原话") or sp["id"],
                    "说明": "%d 天了，要么孵化成选题，要么标废弃。" % age,
                    "目标": {"kind": "灵感", "id": sp["id"]},
                })

    stale = [p for p in state["投放"] if days_since(p.get("更新于")) >= 7]
    if stale:
        todos.append({
            "级别": "gray",
            "类型": "投放数据该刷了",
            "标题": "%d 条投放超过 7 天没更新" % len(stale),
            "说明": "发布 7 天后的数据才有参考价值，更久的数据意义不大。",
            "目标": {"kind": "数据", "id": ""},
        })

    todos.sort(key=lambda x: 0 if x["级别"] == "red" else 1)
    return todos


# ---------------------------------------------------------------- 统计

def week_start(day):
    return day - timedelta(days=day.weekday())


def brief(rows):
    return {
        "篇数": len(rows),
        "阅读": sum(r["阅读"] for r in rows),
        "点赞": sum(r["点赞"] for r in rows),
        "收藏": sum(r["收藏"] for r in rows),
        "评论": sum(r["评论"] for r in rows),
        "互动": sum(r["互动"] for r in rows),
        "涨粉": sum(r["涨粉"] for r in rows),
    }


def build_stats(state):
    rows = state["投放"]
    today = date.today()
    monday = week_start(today)
    sunday = monday + timedelta(days=6)
    goal = int(settings().get("每周目标") or 5)

    def between(a, b):
        return [r for r in rows if a.isoformat() <= r["发布日"] <= b.isoformat()]

    cur = brief(between(monday, sunday))
    prev = brief(between(monday - timedelta(days=7), sunday - timedelta(days=7)))

    acc_map = dict((a["id"], a) for a in state["账号"])

    by_acc = {}
    for r in rows:
        a = acc_map.get(r["账号"], {})
        key = r["账号"] or "未归类"
        node = by_acc.setdefault(key, {
            "账号": key, "平台": a.get("平台", "未标记"),
            "账号名": a.get("账号名", key), "篇数": 0,
            "阅读": 0, "互动": 0, "涨粉": 0,
        })
        node["篇数"] += 1
        node["阅读"] += r["阅读"]
        node["互动"] += r["互动"]
        node["涨粉"] += r["涨粉"]
    acc_list = sorted(by_acc.values(), key=lambda x: x["阅读"], reverse=True)
    for a in acc_list:
        a["互动率"] = round(a["互动"] * 100.0 / a["阅读"], 2) if a["阅读"] else 0.0

    by_platform = {}
    for a in acc_list:
        p = by_platform.setdefault(a["平台"], {
            "平台": a["平台"], "篇数": 0, "阅读": 0, "互动": 0, "涨粉": 0})
        for k in ("篇数", "阅读", "互动", "涨粉"):
            p[k] += a[k]
    plat_list = sorted(by_platform.values(), key=lambda x: x["阅读"], reverse=True)
    for p in plat_list:
        p["互动率"] = round(p["互动"] * 100.0 / p["阅读"], 2) if p["阅读"] else 0.0

    weeks = []
    for i in range(5, -1, -1):
        m = monday - timedelta(days=7 * i)
        s = brief(between(m, m + timedelta(days=6)))
        weeks.append({"开始": m.isoformat(), "标签": "%d/%d" % (m.month, m.day),
                      "本周": i == 0, **s})

    daily = []
    for i in range(7):
        d = monday + timedelta(days=i)
        s = brief([r for r in between(monday, sunday) if r["发布日"] == d.isoformat()])
        daily.append({"日期": d.isoformat(), "周": WEEKDAYS[i], "今天": d == today,
                      "未到": d > today, **s})

    best = max(rows, key=lambda r: r["阅读"]) if rows else None

    return {
        "今天": today.isoformat(),
        "本周": {
            "起": monday.isoformat(), "止": sunday.isoformat(),
            "标签": "%d/%d – %d/%d" % (monday.month, monday.day, sunday.month, sunday.day),
            "第几天": today.weekday() + 1,
            "剩几天": (sunday - today).days,
            "目标": goal,
            "完成率": round(min(cur["篇数"] * 100.0 / goal, 999), 1) if goal else 0,
            **cur,
            "上周篇数": prev["篇数"], "上周阅读": prev["阅读"], "上周互动": prev["互动"],
        },
        "每日": daily,
        "周趋势": weeks,
        "按账号": acc_list,
        "按平台": plat_list,
        "累计": brief(rows),
        "最佳": best,
        "有数据": len(rows) > 0,
    }


# ---------------------------------------------------------------- 状态汇总

def id_list(raw):
    """「目标身份」这类字段可能是多个 id，逗号、顿号、空格都认。"""
    return [x for x in re.split(r"[,，、\s]+", str(raw or "")) if x]


def belongs(raw, cur):
    """空的算通用（谁都看得见），否则必须命中当前身份。"""
    if is_blank(raw):
        return True
    return cur in id_list(raw)


def build_persona_view(pid=""):
    """人设页专用：只给一个身份，附上它的小节顺序、账号和完整度。"""
    idents = list_entity("身份")
    item = None
    for p in idents:
        if p["id"] == pid:
            item = p
            break
    if item is None and idents:
        item = idents[0]

    accs = [a for a in list_entity("账号") if a.get("身份") == (item or {}).get("id")]
    pubs = read_pubs()
    pub_by_acc = {}
    for row in pubs:
        pub_by_acc[row.get("账号") or ""] = pub_by_acc.get(row.get("账号") or "", 0) + 1
    for a in accs:
        a["投放数"] = pub_by_acc.get(a["id"], 0)

    sec = split_sections((item or {}).get("正文") or "")

    def filled(key):
        text = (sec.get(key) or "").strip()
        return bool(text) and not text.startswith("（待补")

    # 短字段 + 小节一起算完整度，空着的直接告诉页面标出来
    blanks = [k for k in PERSONA_FIELDS if not str((item or {}).get(k) or "").strip()]
    blanks += [k for k in PERSONA_SECTIONS if not filled(k)]

    total = len(PERSONA_FIELDS) + len(PERSONA_SECTIONS)
    return {
        "人设": item or {},
        "小节": PERSONA_SECTIONS,
        "小节内容": sec,
        "账号": accs,
        "身份清单": [{"id": p["id"], "名称": p.get("名称", ""), "头像": p.get("头像", "")}
                 for p in idents],
        "缺什么": blanks,
        "完整度": int(round((total - len(blanks)) * 100.0 / total)),
    }


def build_state(ident_id=""):
    state = {}
    for kind in ("身份", "账号", "灵感", "选题", "稿件"):
        state[kind] = list_entity(kind)
    state["投放"] = read_pubs()

    all_idents = list(state["身份"])
    all_accs = list(state["账号"])

    # 当前身份：请求指定的 > 设置里的 > 第一个
    want = str(ident_id or "").strip() or (settings().get("身份") or "")
    ident = None
    for p in all_idents:
        if p["id"] == want:
            ident = p
            break
    if ident is None and all_idents:
        ident = all_idents[0]
    cur = ident["id"] if ident else ""

    # 身份清单：左下角切换器要用，永远给全量，不跟着当前身份收窄
    pub_by_acc = {}
    for row in state["投放"]:
        pub_by_acc[row.get("账号") or ""] = pub_by_acc.get(row.get("账号") or "", 0) + 1
    drafts_by_id = {}
    for d in state["稿件"]:
        drafts_by_id[d.get("身份") or ""] = drafts_by_id.get(d.get("身份") or "", 0) + 1

    roster = []
    for p in all_idents:
        accs = [a for a in all_accs if a.get("身份") == p["id"]]
        roster.append({
            "id": p["id"],
            "名称": p.get("名称", ""),
            "定位": p.get("定位", ""),
            "稿件数": drafts_by_id.get(p["id"], 0),
            "平台": [{
                "id": a["id"],
                "平台": a.get("平台", ""),
                "账号名": a.get("账号名", ""),
                "状态": a.get("状态", "正常"),
                "投放数": pub_by_acc.get(a["id"], 0),
            } for a in accs],
        })

    # 补一层关联显示用的小字段，省得前端自己 join
    draft_map = dict((d["id"], d) for d in state["稿件"])
    topic_map = dict((t["id"], t) for t in state["选题"])
    acc_map = dict((a["id"], a) for a in all_accs)

    for d in state["稿件"]:
        t = topic_map.get(d.get("选题"), {})
        d["选题标题"] = (t.get("标题候选") or "").split("|")[0].strip() or d.get("选题", "")
        # 一篇稿只服务一个平台：配图和排版都按单一规格做，多发要另开一篇
        d["目标平台"] = t.get("目标平台") or ""
        # 字数只算「## 正文」这一节，别把小节标题和配图排版也算成文章字数
        d["字数"] = len(re.sub(r"\s", "", sections_of(d.get("正文") or "").get("正文") or ""))
        # 五阶段：前端靠这几个字段画进度条，不用自己算
        here = stage_of(d)
        d["阶段"] = here
        d["阶段名"] = STAGE_LABEL.get(here, here)
        d["阶段序号"] = STAGES.index(here) + 1
        d["阶段总数"] = len(STAGES)
        d["待重做"] = redo_list(d)
        secs = sections_of(d.get("正文") or "")
        d["有产物"] = [s for s in STAGES if has_product(d, secs, s)]
        # 素材：AI 搜的和粘的链接都落在「## 素材」；拖进来的文件在 数据/素材/<id>/
        d["素材"] = secs.get("素材") or ""
        d["文件"] = list_assets(d["id"])
        mode = str(d.get("配图形式") or "").strip()
        d["配图形式"] = mode if mode in IMAGE_MODES else "公众号"

    for t in state["选题"]:
        t["稿件"] = [d["id"] for d in state["稿件"] if d.get("选题") == t["id"]]
        t["缺冲突"] = [f for f in CONFLICT_FIELDS if is_blank(t.get(f))]
        t["归属未定"] = is_blank(t.get("目标身份"))

    for p in state["投放"]:
        a = acc_map.get(p["账号"], {})
        p["平台"] = a.get("平台", "未标记")
        p["账号名"] = a.get("账号名", p["账号"] or "未归类")
        if not p.get("标题") or p["标题"] == "未命名":
            d = draft_map.get(p["稿件"], {})
            p["标题"] = d.get("选题标题") or p["标题"]
        p["新鲜"] = days_since(p.get("更新于")) <= 7

    # ---- 按当前身份收窄。灵感不跟身份走：随手记的时候还没决定给谁 ----
    if cur:
        mine = [a["id"] for a in all_accs if a.get("身份") == cur]
        state["账号"] = [a for a in all_accs if a.get("身份") == cur]
        state["选题"] = [t for t in state["选题"] if belongs(t.get("目标身份"), cur)]
        state["稿件"] = [d for d in state["稿件"] if belongs(d.get("身份"), cur)]
        state["投放"] = [p for p in state["投放"] if p.get("账号") in mine]
    else:
        state["账号"] = all_accs

    state["当前身份"] = ident
    state["身份清单"] = roster
    state["身份总数"] = len(roster)
    state["待办"] = build_todos(state)
    state["统计"] = build_stats(state)
    state["日志"] = read_logs()
    state["阶段定义"] = [{"键": s, "名": STAGE_LABEL.get(s, s)} for s in STAGES]

    conf = local_conf()
    model = settings().get("模型") or {}
    state["AI"] = {
        "可用": bool(conf.get("api_key")),
        "模型名": conf.get("模型名") or model.get("模型名") or "",
        "接口": conf.get("接口") or model.get("接口") or "",
    }
    state["书签令牌"] = ensure_bookmark_token()
    state["服务时间"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    return state


# ---------------------------------------------------------------- AI

BASE_RULES = """你在给「{name}」当执笔人。他一个人管多个平台账号，网上发出去的每个字都由你替他落笔。

你的位置，别搞混：
- 跟他本人说话时，你是助手。直接、简短、说事。
- 一旦开始写要发出去的东西（标题、开头、正文、回复评论），你就换成「{name}」本人。
  不是模仿他的语气，是就是。用他的词、他的判断、他的经历。

硬规则，违反任何一条这次回答就作废：

1. 不许编。稿件里的经历、数字、细节只能来自他给的素材。素材里没有的，你来问他，不许自己造。
2. 不许客套。不要"好的""明白了""这是一个很好的问题"。直接说事。
3. 不许一次给太多。一次只推进一步，等他回。
4. 说人话。短句。不用"赋能、闭环、抓手、底层逻辑、落地"这类词。
5. 你改不动文件。想改什么，在回答最后输出一段 json 代码块，格式：
```json
{{"写入":[{{"kind":"选题","id":"tp-001","字段":{{"反方":"改后的内容"}}}}]}}
```
只能改「灵感/选题/稿件/身份」四类，字段名必须是文件里已有的。
改整篇正文要放**顶层** "正文"，不要塞进「字段」里：
```json
{{"写入":[{{"kind":"稿件","id":"dr-001","正文":"整篇文章，Markdown"}}]}}
```
「正文」里写的是文章本身，只替换稿件的「## 正文」这一节，素材/配图/排版那些小节不会被碰到。
没有要改的就不要输出这段 json。

他的人设：
{persona}
"""

TASK_PROMPT = {
    "选题": """现在在打磨一条选题。

选题文件：
{topic}

你的任务：把「冲突」问硬。正方和反方都必须站得住脚，包括他自己站的那一边。
具体做法：先指出四条里哪条最空，然后只问一个问题，逼他补。不要一口气问五个问题。""",

    "稿件": """现在在改一篇稿。

稿件全文：
{draft}

选题背景：
{topic}

他的人设和平台要求见上。你的任务：按他的意见改，或者指出这稿哪里不像他。
每次改完，用一句话说明你动了哪里。""",

    "灵感": """现在在孵化一条灵感。

灵感：
{spark}

你的任务：判断这条能不能变成选题。能，就帮他把「核心冲突」逼出来（正方/反方/我站/我可能错在哪）。
不能，就直接说不能，并说明为什么。别硬凑。""",

    "全局": """现在没有选中具体对象，他在跟你闲聊或问整体情况。

当前盘子：
- 选题 {n_topic} 条，其中 {n_bad} 条冲突没填全
- 稿件 {n_draft} 篇
- 灵感 {n_spark} 条
- 近期投放 {n_pub} 条

先回答他的问题。如果他说不出想干什么，你就从上面这些里挑一件最该做的，直接说"我们先弄这个"，别问"你想做什么"。""",
}


def split_sections(body):
    """把正文按 `## 小节名` 切开。开头的无标题部分丢掉（都是空行）。"""
    out, cur, buf = {}, "", []
    for line in (body or "").splitlines():
        if line.startswith("## "):
            if cur:
                out[cur] = "\n".join(buf).strip()
            cur = line[3:].strip()
            buf = []
        else:
            buf.append(line)
    if cur:
        out[cur] = "\n".join(buf).strip()
    return out


def build_persona(ident):
    """把人设文件拼成模型能读懂的一段。空着的地方明确标出来，别让 AI 自己补。"""
    if not ident:
        return "（还没写人设）"

    sec = split_sections(ident.get("正文") or "")

    def got(key):
        """小节有内容、且不是「待补」占位。"""
        text = (sec.get(key) or "").strip()
        if not text or text.startswith("（待补"):
            return ""
        return text

    name = ident.get("名称") or "他"
    L = ["【你是谁】"]
    L.append("名字：%s%s" % (name, (" " + ident["头像"]) if ident.get("头像") else ""))
    if ident.get("一句话"):
        L.append("一句话：%s" % ident["一句话"])
    for key in ("年龄", "生日"):
        if ident.get(key):
            L.append("%s：%s" % (key, ident[key]))
    if got("这个人是谁"):
        L.append(got("这个人是谁"))

    if ident.get("定位") or ident.get("领域") or ident.get("读者") or got("要传递什么"):
        L.append("\n【账号定位】")
        if ident.get("定位"):
            L.append("- 定位：%s" % ident["定位"])
        if ident.get("领域"):
            L.append("- 领域：%s" % ident["领域"])
        if ident.get("读者"):
            L.append("- 写给谁：%s" % ident["读者"])
        if got("要传递什么"):
            L.append("- 想让读者记住的一件事：%s" % got("要传递什么"))

    if ident.get("语气") or got("说话方式"):
        L.append("\n【你怎么说话】")
        if ident.get("语气"):
            L.append("语气：%s" % ident["语气"])
        if got("说话方式"):
            L.append(got("说话方式"))

    for key, label in (("模仿样例", "他写过的样子，照着这个口气"),
                       ("写作习惯", "你怎么写"),
                       ("视觉与设计风格", "你的视觉调性"),
                       ("平台差异", "平台差异"),
                       ("别做的事", "你绝不做的")):
        if got(key):
            L.append("\n【%s】\n%s" % (label, got(key)))

    missing = [k for k in PERSONA_SECTIONS if not got(k)]
    if missing:
        L.append("\n【还没填的】%s。写到这些地方先问他，不许自己补。" % "、".join(missing))

    return "\n".join(L)


def build_messages(state, kind, item_id, history):
    ident = state["当前身份"] or {}
    system = BASE_RULES.format(name=ident.get("名称", "他"),
                               persona=build_persona(ident))

    topic_map = dict((t["id"], t) for t in state["选题"])

    def render(item):
        if not item:
            return "（没找到这个文件）"
        head = []
        for k in ORDER.get(kind, []):
            if item.get(k):
                head.append("%s: %s" % (k, item[k]))
        return "\n".join(head) + "\n\n" + (item.get("正文") or "")

    item = None
    for x in state.get(kind, []):
        if x["id"] == item_id:
            item = x
            break

    if kind == "选题":
        task = TASK_PROMPT["选题"].format(topic=render(item))
    elif kind == "稿件":
        task = TASK_PROMPT["稿件"].format(
            draft=render(item), topic=render(topic_map.get((item or {}).get("选题"))))
    elif kind == "灵感":
        task = TASK_PROMPT["灵感"].format(spark=render(item))
    else:
        bad = sum(1 for t in state["选题"] if t.get("缺冲突"))
        task = TASK_PROMPT["全局"].format(
            n_topic=len(state["选题"]), n_bad=bad,
            n_draft=len(state["稿件"]), n_spark=len(state["灵感"]),
            n_pub=len(state["投放"]))

    msgs = [{"role": "system", "content": system + "\n\n" + task}]
    for m in (history or [])[-12:]:
        role = "assistant" if m.get("role") == "assistant" else "user"
        content = str(m.get("content") or "").strip()
        if content:
            msgs.append({"role": role, "content": content})
    return msgs


def model_endpoint():
    conf = local_conf()
    model = settings().get("模型") or {}
    base = (conf.get("接口") or model.get("接口") or "https://api.deepseek.com").rstrip("/")
    name = conf.get("模型名") or model.get("模型名") or "deepseek-chat"
    if base.endswith("/chat/completions"):
        url = base
    elif "/v1" in base:
        url = base + "/chat/completions"
    else:
        url = base + "/v1/chat/completions"
    return url, name, conf.get("api_key") or "", conf.get("代理") or ""


def stream_model(messages):
    """调模型，逐段吐字。生成器。"""
    url, name, key, proxy = model_endpoint()
    if not key:
        raise ValueError("还没有 API Key。在根目录建一个 本地配置.json，写 "
                         '{"api_key": "sk-..."}，然后重启服务。')

    body = json.dumps({
        "model": name, "messages": messages,
        "stream": True, "temperature": 0.7,
    }).encode("utf-8")

    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key,
        "Accept": "text/event-stream",
    })

    # 环境里的 http_proxy 可能是内部代理，连不通模型接口。配了代理就用配的。
    if proxy:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    else:
        opener = urllib.request.build_opener()

    try:
        resp = opener.open(req, timeout=120)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        raise ValueError("模型接口返回 %s：%s" % (exc.code, detail))
    except urllib.error.URLError as exc:
        raise ValueError("连不上模型接口（%s）。如果是网络问题，在 本地配置.json 里加 "
                         '"代理": "http://127.0.0.1:7890" 再试。' % exc.reason)

    for raw in resp:
        line = raw.decode("utf-8", "replace").strip()
        if not line or not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if payload == "[DONE]":
            break
        try:
            obj = json.loads(payload)
        except ValueError:
            continue
        choices = obj.get("choices") or []
        if not choices:
            continue
        piece = (choices[0].get("delta") or {}).get("content") or ""
        if piece:
            yield piece


WRITE_BLOCK = re.compile(r"```json\s*(\{[\s\S]*?\"写入\"[\s\S]*?\})\s*```")


def extract_writes(text):
    """从回答里捞出「写入」指令。捞不到就返回空列表。"""
    out = []
    for m in WRITE_BLOCK.finditer(text or ""):
        try:
            obj = json.loads(m.group(1))
        except ValueError:
            continue
        for w in obj.get("写入") or []:
            if not isinstance(w, dict):
                continue
            kind = str(w.get("kind") or "").strip()
            item_id = str(w.get("id") or "").strip()
            if kind not in ("灵感", "选题", "稿件") or not item_id:
                continue
            fields = w.get("字段") or {}
            if not isinstance(fields, dict):
                fields = {}
            fields = dict((str(k), str(v)) for k, v in fields.items())
            # 正文是整段文章，不是普通字段：放顶层，也兼容模型塞进「字段」里
            body = fields.pop("正文", None)
            if isinstance(w.get("正文"), str) and w["正文"].strip():
                body = w["正文"]
            out.append({"kind": kind, "id": item_id, "字段": fields,
                        "正文": (body or "").strip()})
    return out


# ---------------------------------------------------------------- HTTP

class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        pass

    def _json(self, obj, code=200):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _body(self):
        size = int(self.headers.get("Content-Length") or 0)
        if not size:
            return {}
        return json.loads(self.rfile.read(size).decode("utf-8") or "{}")

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        q = parse_qs(parsed.query)
        try:
            if path == "/api/state":
                who = (q.get("ident") or q.get("身份") or [""])[0]
                return self._json({"ok": True, **build_state(who)})
            if path == "/api/persona":
                pid = (q.get("id") or [""])[0]
                return self._json({"ok": True, **build_persona_view(pid)})
            if path in ("/", "/index.html"):
                return self._serve("index.html")
        except Exception as exc:
            return self._json({"ok": False, "error": str(exc)}, 500)
        return super().do_GET()

    def _serve(self, name):
        path = os.path.join(ROOT, name)
        if not os.path.isfile(path):
            return self._json({"ok": False, "error": "找不到 %s" % name}, 404)
        with open(path, "rb") as f:
            raw = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/write":
                p = self._body()
                item = save_entity(p.get("kind", ""), p.get("id", ""),
                                   p.get("字段") or None, p.get("正文"))
                return self._json({"ok": True, "item": item})
            if path == "/api/section":
                p = self._body()
                item = save_section(p.get("kind", "身份"), p.get("id", ""),
                                    p.get("小节", ""), p.get("内容", ""))
                return self._json({"ok": True, "item": item})
            if path == "/api/asset":
                p = self._body()
                name = save_asset(p.get("稿件", ""), p.get("名字", ""), p.get("数据", ""))
                return self._json({"ok": True, "名字": name,
                                   "文件": list_assets(p.get("稿件", ""))})
            if path == "/api/stage":
                p = self._body()
                item = advance_stage(p.get("kind", "稿件"), p.get("id", ""),
                                     p.get("阶段", ""), p.get("说明", ""))
                return self._json({"ok": True, "item": item})
            if path == "/api/new":
                p = self._body()
                item = new_entity(p.get("kind", ""), p)
                return self._json({"ok": True, "item": item})
            if path == "/api/new_draft":
                p = self._body()
                item = new_draft(p.get("选题", ""), p.get("身份", ""))
                return self._json({"ok": True, "item": item})
            if path == "/api/ingest":
                p = self._body()
                if str(p.get("令牌") or "") != ensure_bookmark_token():
                    return self._json({"ok": False, "error": "令牌不对"}, 403)
                return self._json({"ok": True, "投放": add_pub(p)})
            if path == "/api/pub":
                return self._json({"ok": True, "投放": add_pub(self._body())})
            if path == "/api/chat":
                return self._chat()
        except Exception as exc:
            return self._json({"ok": False, "error": str(exc)}, 400)
        return self._json({"ok": False, "error": "未知接口"}, 404)

    def _chat(self):
        """SSE 流式。不设 Content-Length，写完关连接。"""
        p = self._body()
        kind = str(p.get("kind") or "全局")
        item_id = str(p.get("id") or "")
        ident_id = str(p.get("身份") or "")
        history = p.get("messages") or []

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()

        def emit(obj):
            self.wfile.write(("data: " + json.dumps(obj, ensure_ascii=False) + "\n\n")
                             .encode("utf-8"))
            self.wfile.flush()

        full = ""
        try:
            state = build_state(ident_id)
            messages = build_messages(state, kind, item_id, history)
            for piece in stream_model(messages):
                full += piece
                emit({"delta": piece})
            emits = extract_writes(full)
            clean = WRITE_BLOCK.sub("", full).strip()
            if emits:
                emit({"修正": clean})
            emit({"done": True, "写入": emits})
        except Exception as exc:
            emit({"error": str(exc)})
        try:
            self.close_connection = True
        except Exception:
            pass


def main():
    for d in DIRS.values():
        os.makedirs(d, exist_ok=True)
    if not os.path.isfile(PUB_CSV):
        write_pubs([])
    ensure_bookmark_token()

    url = "http://127.0.0.1:%d/" % PORT
    conf = local_conf()
    print("\n  内容矩阵控制台已启动")
    print("  地址：%s" % url)
    print("  数据：%s" % DATA)
    print("  AI：%s" % ("已配置 " + (conf.get("模型名") or "") if conf.get("api_key")
                        else "未配置（本地配置.json 里还没有 api_key）"))
    print("  关闭这个窗口即停止服务\n")

    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("已停止")


if __name__ == "__main__":
    main()
