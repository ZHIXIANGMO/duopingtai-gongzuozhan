# -*- coding: utf-8 -*-
"""内容流水线 - 本地小服务

只干两件事：
  1. 把 工作台.html 托管在 http://127.0.0.1:8777/
  2. 读写 数据/内容/*.md 的 frontmatter

不联网、不装第三方库、只监听本机回环地址。
"""

import csv
import json
import os
import sys
import threading
import webbrowser
from datetime import date, datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.abspath(__file__))
CONTENT = os.path.join(ROOT, "数据", "内容")
PUBLISHED = os.path.join(ROOT, "数据", "发布记录.csv")
SETTINGS = os.path.join(ROOT, "数据", "设置.json")
PAGE = "index.html"
PORT = 8777
WEEK_GOAL = 5
WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"]

# frontmatter 的固定字段顺序，写回时按这个排，避免每次 diff 都乱序
ORDER = [
    "id", "标题", "渠道", "阶段", "状态", "待你确认", "优先级",
    "调研", "选题", "草稿", "配图", "排版", "发布", "送审", "数据", "复盘",
    "创建", "更新", "阅读", "点赞", "收藏", "评论",
]
STEPS = ["调研", "选题", "草稿", "配图", "排版", "发布", "送审", "数据", "复盘"]
GATE_STEP = {"讨论": "选题", "草稿": "草稿", "配图": "配图", "排版": "排版"}


# ---------- 读写 md ----------

def parse_item(path):
    """拆出 frontmatter 与正文。只支持 key: value 的扁平结构，够用且不引依赖。"""
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


def write_item(path, meta, body):
    lines = ["---"]
    for k in ORDER:
        if k in meta:
            val = meta[k]
            if k == "id" and not str(val).startswith('"'):
                val = '"%s"' % val
            lines.append("%s: %s" % (k, val))
    for k, v in meta.items():
        if k not in ORDER:
            lines.append("%s: %s" % (k, v))
    lines.append("---")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n\n" + body)


def age_days(meta):
    """距离上次更新几天，用来标「卡住了」。"""
    raw = meta.get("更新") or meta.get("创建")
    try:
        d = datetime.strptime(raw, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return 0
    return max((date.today() - d).days, 0)


def board():
    items = []
    if os.path.isdir(CONTENT):
        for name in sorted(os.listdir(CONTENT)):
            if not name.lower().endswith(".md"):
                continue
            path = os.path.join(CONTENT, name)
            try:
                meta, body = parse_item(path)
            except Exception as exc:
                items.append({"id": name, "标题": name, "读取失败": str(exc)})
                continue
            item = dict(meta)
            item.setdefault("id", os.path.splitext(name)[0])
            item.setdefault("标题", item["id"])
            item["正文"] = body
            item["文件"] = name
            item["卡住天数"] = age_days(meta)
            item["环节"] = [{"名": s, "态": meta.get(s, "未开始")} for s in STEPS]
            items.append(item)
    return {"ok": True, "items": items, "服务时间": datetime.now().strftime("%Y-%m-%d %H:%M")}


# ---------- 人工确认 ----------

def confirm(payload):
    item_id = str(payload.get("id", "")).strip()
    gate = str(payload.get("gate", "")).strip()
    decision = str(payload.get("decision", "")).strip()
    note = str(payload.get("note", "")).strip()

    if not item_id:
        raise ValueError("缺少 id")
    if gate not in GATE_STEP:
        raise ValueError("未知的确认点：%s" % gate)
    if decision not in ("pass", "reject"):
        raise ValueError("decision 只能是 pass 或 reject")

    path = os.path.join(CONTENT, "%s.md" % item_id)
    if not os.path.isfile(path):
        raise ValueError("找不到文件：%s" % path)

    meta, body = parse_item(path)
    today = date.today().isoformat()
    step = GATE_STEP[gate]

    if decision == "pass":
        if gate == "讨论":
            meta["选题"] = "完成"
            meta["草稿"] = "进行中"
            meta["阶段"] = "写稿"
            meta["状态"] = "选题方案已定，AI 开始写初稿"
        elif gate == "草稿":
            meta["草稿"] = "完成"
            meta["配图"] = "进行中"
            meta["阶段"] = "后期"
            meta["状态"] = "初稿已定，进入后期，AI 开始配图"
        elif gate == "配图":
            meta["配图"] = "完成"
            meta["排版"] = "进行中"
            meta["状态"] = "配图已定，AI 开始排版"
        else:
            meta["排版"] = "完成"
            meta["发布"] = "进行中"
            meta["状态"] = "排版已过，准备发布"
        meta["待你确认"] = "无"
    else:
        if not note:
            raise ValueError("打回需要写一句原因，否则 AI 不知道为什么返工")
        meta[step] = "打回"
        meta["待你确认"] = "无"
        meta["状态"] = "已打回，等 AI 返工"
        bullet = "- %s 【%s】打回：%s\n" % (today, gate, note)
        if "## 人工意见" in body:
            body = body.rstrip("\n") + "\n" + bullet
        else:
            body = body.rstrip("\n") + "\n\n## 人工意见\n" + bullet

    meta["更新"] = today
    write_item(path, meta, body)

    fresh, _ = parse_item(path)
    fresh["环节"] = [{"名": s, "态": fresh.get(s, "未开始")} for s in STEPS]
    fresh["卡住天数"] = age_days(fresh)
    return {"ok": True, "item": fresh, "说明": "已放行" if decision == "pass" else "已打回"}


# ---------- 发布数据 ----------

def num(raw):
    """CSV 里的数字可能是空、带千分位或带「万」，统一转成 int。"""
    s = str(raw or "").strip().replace(",", "").replace("，", "")
    if not s:
        return 0
    try:
        return int(float(s))
    except ValueError:
        return 0


def read_published():
    """读 数据/发布记录.csv。一行 = 一次发布（同一篇稿子发两个平台就是两行）。"""
    if not os.path.isfile(PUBLISHED):
        return []
    rows = []
    with open(PUBLISHED, "r", encoding="utf-8-sig", newline="") as f:
        for raw in csv.DictReader(f):
            day = (raw.get("日期") or "").strip()
            if not day:
                continue
            read = num(raw.get("阅读"))
            like = num(raw.get("点赞"))
            fav = num(raw.get("收藏"))
            cmt = num(raw.get("评论"))
            rows.append({
                "日期": day,
                "内容ID": (raw.get("内容ID") or "").strip(),
                "标题": (raw.get("标题") or "").strip() or "未命名",
                "平台": (raw.get("平台") or "").strip() or "未标记",
                "阅读": read,
                "点赞": like,
                "收藏": fav,
                "评论": cmt,
                "涨粉": num(raw.get("涨粉")),
                "互动": like + fav + cmt,
                "互动率": round((like + fav + cmt) * 100.0 / read, 2) if read else 0.0,
            })
    rows.sort(key=lambda r: (r["日期"], r["标题"]), reverse=True)
    return rows


def week_start(day):
    return day - timedelta(days=day.weekday())


def summarize(rows):
    return {
        "篇数": len(rows),
        "阅读": sum(r["阅读"] for r in rows),
        "点赞": sum(r["点赞"] for r in rows),
        "收藏": sum(r["收藏"] for r in rows),
        "评论": sum(r["评论"] for r in rows),
        "互动": sum(r["互动"] for r in rows),
        "涨粉": sum(r["涨粉"] for r in rows),
    }


def stats():
    rows = read_published()
    today = date.today()
    monday = week_start(today)
    sunday = monday + timedelta(days=6)

    def between(a, b):
        return [r for r in rows if a.isoformat() <= r["日期"] <= b.isoformat()]

    goal = WEEK_GOAL
    if os.path.isfile(SETTINGS):
        try:
            with open(SETTINGS, "r", encoding="utf-8-sig") as f:
                goal = int(json.load(f).get("每周目标") or goal)
        except Exception:
            pass

    this_week = between(monday, sunday)
    last_week = between(monday - timedelta(days=7), sunday - timedelta(days=7))
    cur, prev = summarize(this_week), summarize(last_week)

    # 本周七天，缺的那天补 0，图表才有完整的七个柱子
    daily = []
    for i in range(7):
        d = monday + timedelta(days=i)
        hit = [r for r in this_week if r["日期"] == d.isoformat()]
        s = summarize(hit)
        daily.append({
            "日期": d.isoformat(),
            "周": WEEKDAYS[i],
            "篇数": s["篇数"],
            "阅读": s["阅读"],
            "互动": s["互动"],
            "今天": d == today,
            "未到": d > today,
        })

    # 近 6 周，从旧到新
    weeks = []
    for i in range(5, -1, -1):
        m = monday - timedelta(days=7 * i)
        sel = between(m, m + timedelta(days=6))
        s = summarize(sel)
        weeks.append({
            "开始": m.isoformat(),
            "标签": "%d/%d" % (m.month, m.day),
            "本周": i == 0,
            **s,
        })

    # 平台汇总
    platforms = {}
    for r in rows:
        p = platforms.setdefault(r["平台"], {"平台": r["平台"], "篇数": 0, "阅读": 0,
                                            "点赞": 0, "收藏": 0, "评论": 0, "互动": 0, "涨粉": 0})
        for k in ("篇数", "阅读", "点赞", "收藏", "评论", "互动", "涨粉"):
            p[k] += r[k] if k != "篇数" else 1
    plist = sorted(platforms.values(), key=lambda p: p["阅读"], reverse=True)
    for p in plist:
        p["互动率"] = round(p["互动"] * 100.0 / p["阅读"], 2) if p["阅读"] else 0.0

    best = max(rows, key=lambda r: r["阅读"]) if rows else None

    return {
        "ok": True,
        "今天": today.isoformat(),
        "本周": {
            "起": monday.isoformat(),
            "止": sunday.isoformat(),
            "标签": "%d/%d – %d/%d" % (monday.month, monday.day, sunday.month, sunday.day),
            "第几天": today.weekday() + 1,
            "剩几天": (sunday - today).days,
            "目标": goal,
            "完成率": round(min(cur["篇数"] * 100.0 / goal, 999), 1) if goal else 0,
            **cur,
            "上周篇数": prev["篇数"],
            "上周阅读": prev["阅读"],
            "上周互动": prev["互动"],
        },
        "每日": daily,
        "周趋势": weeks,
        "平台": plist,
        "明细": rows,
        "累计": summarize(rows),
        "最佳": best,
        "服务时间": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }


# ---------- HTTP ----------

class Handler(SimpleHTTPRequestHandler):
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

    def _page(self):
        path = os.path.join(ROOT, PAGE)
        if not os.path.isfile(path):
            return self._json({"ok": False, "error": "找不到 %s" % PAGE}, 404)
        with open(path, "rb") as f:
            raw = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/board":
            return self._json(board())
        if path == "/api/stats":
            return self._json(stats())
        if path in ("/", "/index.html"):
            return self._page()
        return super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/confirm":
            return self._json({"ok": False, "error": "未知接口"}, 404)
        try:
            size = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(size).decode("utf-8") or "{}")
            return self._json(confirm(payload))
        except Exception as exc:
            return self._json({"ok": False, "error": str(exc)}, 400)


def main():
    os.makedirs(CONTENT, exist_ok=True)
    url = "http://127.0.0.1:%d/" % PORT
    print("\n  内容流水线已启动")
    print("  地址：%s" % url)
    print("  数据：%s" % CONTENT)
    print("  关闭这个窗口即停止服务\n")
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("已停止")


if __name__ == "__main__":
    main()
