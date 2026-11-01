"""零依赖回归：所有数据写入临时目录，模型请求只到本机模拟服务。"""
import json
import http.client
import os
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import serve


class Model(BaseHTTPRequestHandler):
    requests = []
    mode = 'ok'

    def log_message(self, *args):
        pass

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.requests.append(payload)
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        if self.mode == 'empty':
            self.wfile.write(b'data: [DONE]\n\n')
            return
        for piece in ('# 临时测试初稿\n\n', '按样例写短句。\n\n### 一个观点\n素材中的事实。'):
            self.wfile.write(('data: ' + json.dumps({'choices':[{'delta':{'content':piece}}]}) + '\n\n').encode())
        if self.mode != 'disconnect':
            reason = 'length' if self.mode == 'length' else 'stop'
            self.wfile.write(('data: ' + json.dumps({'choices':[{'delta':{}, 'finish_reason':reason}]}) + '\n\n').encode())
            self.wfile.write(b'data: [DONE]\n\n')


class WorkflowTest(unittest.TestCase):
    def setUp(self):
        cache = Path(__file__).resolve().parent / '.cache'
        cache.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=cache)
        root = Path(self.temp.name)
        assert root.resolve().is_relative_to(cache.resolve())
        self.addCleanup(self.temp.cleanup)
        self.patch = patch.multiple(serve, DATA=str(root), DIRS={k:str(root/k) for k in serve.DIRS},
            SETTINGS=str(root/'设置.json'), LOCAL_CONF=str(root/'本地配置.json'), ENV_FILE=str(root/'.env'),
            PUB_CSV=str(root/'投放.csv'), LOG_CSV=str(root/'日志.csv'), ASSET_DIR=str(root/'素材'))
        self.patch.start()
        self.addCleanup(self.patch.stop)
        for path in serve.DIRS.values():
            os.makedirs(path)
        serve.write_md(str(root/'身份'/'per-01.md'), {'id':'per-01', '名称':'测试身份', '语气':'短句，不说套话'},
            '## 说话方式\n\n像聊天一样。\n\n## 模仿样例\n\n先试一次，再做判断。\n\n## 写作习惯\n\n先讲事实。', '身份')
        serve.write_md(str(root/'身份'/'per-02.md'), {'id':'per-02', '名称':'另一个身份', '语气':'长句'}, '', '身份')
        self.spark = serve.new_entity('灵感', {'原话':'一个临时测试观点', '身份':'per-01'})
        self.draft = serve.draft_from_spark(self.spark['id'], 'per-01')
        self.model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        Model.requests = []
        Model.mode = 'ok'
        threading.Thread(target=self.model.serve_forever, daemon=True).start()
        self.config = {'当前模型':'one', '模型列表':[{'id':'one', '名称':'本地测试',
            '接口':'http://127.0.0.1:%s/v1' % self.model.server_port, '模型名':'test-model',
            'api_key':'test-secret', '技能':['short']}],
            '技能':[{'id':'short', '名称':'短句技能', '内容':'每段只写一个判断。'}]}
        serve.save_ai_config(self.config)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), serve.Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = 'http://127.0.0.1:%s' % self.server.server_port
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def tearDown(self):
        for server in (self.server, self.model):
            server.shutdown()
            server.server_close()
        self.patch.stop()
        self.temp.cleanup()

    def request(self, path, body=None, headers=None, method=None):
        data = None if body is None else json.dumps(body).encode()
        headers = {'Content-Type':'application/json', **(headers or {})}
        req = urllib.request.Request(self.url + path, data=data, headers=headers, method=method)
        return self.opener.open(req, timeout=10).read().decode()

    def test_generate_preview_adopt_and_context(self):
        path = Path(serve.DIRS['稿件'])/(self.draft['id']+'.md')
        original = path.read_bytes()
        raw = self.request('/api/generate', {'kind':'稿件', 'id':self.draft['id'], '身份':'per-02', '要求':'约 800 字'})
        events = [json.loads(line[6:]) for line in raw.splitlines() if line.startswith('data: ')]
        self.assertNotIn('error', events[-1])
        self.assertEqual(path.read_bytes(), original, '生成预览不应落盘')
        content = ''.join(e.get('delta', '') for e in events)
        prompt = json.dumps(Model.requests[-1], ensure_ascii=False)
        for expected in ('测试身份', '先试一次', '一个临时测试观点', '每段只写一个判断', '800'):
            self.assertIn(expected, prompt)
        self.assertNotIn('另一个身份', prompt)
        adopted = json.loads(self.request('/api/adopt_draft', {'id':self.draft['id'], '正文':content,
            'revision':events[-1]['revision']}))
        self.assertEqual(adopted['item']['阶段'], '正文')
        self.assertIn('### 一个观点', serve.sections_of(adopted['item']['正文'])['正文'])
        self.assertIn('素材', serve.sections_of(adopted['item']['正文']))
        histories = list((Path(serve.DATA)/'.历史'/'稿件').glob('*.md'))
        self.assertTrue(any(p.read_bytes() == original for p in histories), '采用和推进阶段不能覆盖原稿备份')

    def test_stale_preview_rejected(self):
        _, revision = serve.generation_messages(self.draft['id'])
        serve.save_section('稿件', self.draft['id'], '素材', '新素材')
        with self.assertRaisesRegex(ValueError, '发生变化'):
            serve.adopt_draft({'id':self.draft['id'], '正文':'旧预览', 'revision':revision})

    def test_settings_mask_and_keep_key(self):
        public = json.loads(self.request('/api/settings'))
        self.assertNotIn('test-secret', json.dumps(public))
        self.assertTrue(public['模型列表'][0]['已配置密钥'])
        serve.save_ai_config(public)
        self.assertEqual(serve.active_model()['api_key'], 'test-secret')
        public['模型列表'][0]['接口'] = 'https://another.example/v1'
        with self.assertRaisesRegex(ValueError, '重新填写'):
            serve.save_ai_config(public)

    def test_switch_model_and_skills(self):
        self.config['模型列表'].append({'id':'two', '名称':'第二模型', '接口':'https://example.invalid',
                                      '模型名':'second', 'api_key':'other-secret', '技能':[]})
        self.config['当前模型'] = 'two'
        serve.save_ai_config(self.config)
        self.assertEqual(serve.model_endpoint()[1], 'second')
        self.assertEqual(serve.skill_prompt(), '')

    def test_persona_section_replaces_in_place(self):
        serve.save_section('身份', 'per-01', '说话方式', '新说法')
        serve.save_section('身份', 'per-01', '说话方式', '最终说法')
        ident = next(p for p in serve.list_entity('身份') if p['id'] == 'per-01')
        self.assertEqual(ident['正文'].count('## 说话方式'), 1)
        self.assertIn('先试一次', ident['正文'])

    def test_reenter_spark_does_not_duplicate(self):
        d = serve.draft_from_spark(self.spark['id'], 'per-01')
        self.assertEqual(d['id'], self.draft['id'])
        self.assertEqual(len(serve.list_entity('选题')), 1)

    def test_later_stage_products_marked_redo(self):
        serve.save_entity('稿件', self.draft['id'], {'阶段':'排版', '配图形式':'公众号', '排版':'16px'})
        _, revision = serve.generation_messages(self.draft['id'])
        item = serve.adopt_draft({'id':self.draft['id'], '正文':'改后的文章', 'revision':revision})
        self.assertEqual(set(serve.redo_list(item)), {'配图', '排版'})

    def test_incomplete_stream_is_not_success(self):
        for mode in ('empty', 'length', 'disconnect'):
            Model.mode = mode
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                list(serve.stream_model([{'role':'user','content':'test'}]))

    def test_config_private_and_cross_origin_blocked(self):
        for path in ('/.env', '/%2eenv', '/.env.tmp', '/本地配置.json', '/%E6%9C%AC%E5%9C%B0%E9%85%8D%E7%BD%AE.json', '/.git/config', '/serve.py'):
            if not path.isascii():
                continue
            for method in ('GET','HEAD'):
                with self.subTest(path=path, method=method), self.assertRaises(urllib.error.HTTPError) as exc:
                    self.request(path, method=method)
                self.assertEqual(exc.exception.code, 404)
        with self.assertRaises(urllib.error.HTTPError) as exc:
            self.request('/api/settings', self.config, {'Origin':'https://other.example'})
        self.assertEqual(exc.exception.code, 403)

    def test_missing_style_blocks_generation(self):
        serve.save_entity('稿件', self.draft['id'], {'身份':'per-02'})
        serve.save_entity('身份', 'per-02', {'语气':''})
        with self.assertRaisesRegex(ValueError, '人设页'):
            serve.generation_messages(self.draft['id'])

    def test_legacy_config_still_works(self):
        Path(serve.ENV_FILE).unlink()
        Path(serve.LOCAL_CONF).write_text(json.dumps({'api_key':'legacy-key', '模型名':'legacy'}), encoding='utf-8')
        self.assertEqual(serve.model_endpoint()[1:3], ('legacy','legacy-key'))

    def test_env_preserves_other_secrets_and_special_characters(self):
        env = Path(serve.ENV_FILE)
        with env.open('a', encoding='utf-8') as f:
            f.write('EXTRA_PRIVATE_VALUE="keep-this-test-value"\n')
        self.config['模型列表'][0]['api_key'] = 'test-$-#-"-\\-中文'
        serve.save_ai_config(self.config)
        self.assertEqual(serve.active_model()['api_key'], self.config['模型列表'][0]['api_key'])
        self.assertIn('EXTRA_PRIVATE_VALUE="keep-this-test-value"', env.read_text(encoding='utf-8'))
        self.assertFalse(Path(serve.LOCAL_CONF).exists())
        self.assertNotIn('api_key', json.dumps(serve.public_config()))

    def test_migrate_only_configuration_and_verify_before_cleanup(self):
        Path(serve.ENV_FILE).unlink()
        legacy = {'api_key':'legacy-test-key', '模型名':'deepseek-flash'}
        local_settings = {'每周目标':5, '书签令牌':'test-bookmark-token'}
        Path(serve.LOCAL_CONF).write_text(json.dumps(legacy), encoding='utf-8')
        Path(serve.SETTINGS).write_text(json.dumps(local_settings), encoding='utf-8')
        persona = Path(serve.DIRS['身份'])/'per-01.md'
        before = persona.read_bytes()
        result = serve.migrate_private_config()
        self.assertEqual(result['迁移配置文件数'], 2)
        self.assertEqual(serve.read_env_section('DSH_AI_CONFIG'), legacy)
        self.assertEqual(serve.read_env_section('DSH_LOCAL_SETTINGS'), local_settings)
        self.assertFalse(Path(serve.LOCAL_CONF).exists())
        self.assertFalse(Path(serve.SETTINGS).exists())
        self.assertEqual(persona.read_bytes(), before)
        self.assertEqual(serve.migrate_private_config()['迁移配置文件数'], 0)

    def test_invalid_env_is_not_silently_overwritten(self):
        env = Path(serve.ENV_FILE)
        env.write_text('DSH_AI_CONFIG=invalid\n', encoding='utf-8')
        original = env.read_bytes()
        with self.assertRaisesRegex(ValueError, '格式不正确'):
            serve.save_ai_config(self.config)
        self.assertEqual(env.read_bytes(), original)

    def test_connection_test_consumes_request_body(self):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=10)
        try:
            connection.request('POST', '/api/model_test', '{}', {'Content-Type':'application/json'})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            response.read()
            connection.request('GET', '/api/settings')
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            response.read()
        finally:
            connection.close()


if __name__ == '__main__':
    unittest.main()
