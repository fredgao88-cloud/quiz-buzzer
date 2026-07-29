#!/usr/bin/env python3
# 局域网静态服务：禁用浏览器缓存。
# 用途：改了 index.html / display.html / shared.js 后，浏览器普通刷新即拿到最新版本，
# 不会再出现「代码改了但页面还是旧逻辑（读题念下划线、多选点不动等）」。
# 监听 0.0.0.0，同一局域网内其他电脑也能用本机 IP 访问（控制台+大屏须开在同一浏览器里）。
# 用法：python serve.py [端口]   （默认 8080）
import json
import os
import re
import socket
import sys
import unicodedata
import urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

# ── 图片上传 ────────────────────────────────────────
# 网页本身没有写磁盘的权限（浏览器沙箱），所以「上传背景图」这类操作只能由
# 本服务代劳：前端把文件 POST 过来，这里写进 images/ 目录，前端只记住路径。
# 早先是把图片转成 base64 存进 localStorage —— 每域名约 5MB，几张照片就撑爆，
# 撑爆后连分数都存不进去。
IMAGES_DIR = Path(__file__).resolve().parent / 'images'
ALLOWED_EXT = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'}
MAX_UPLOAD = 30 * 1024 * 1024        # 30MB，够放未压缩的高清场景图
HARD_LIMIT = 200 * 1024 * 1024       # 再大就不收了，也不为了报错去读完它


def safe_name(raw: str) -> str | None:
    """把用户传来的文件名压成安全的纯文件名；不合法返回 None。

    只取 basename 并剔除路径分隔符与控制字符 —— 否则 ../../ 之类能写到项目外面去。
    中文文件名要保留（场景图就叫「图A.png」），所以不做 ASCII 化。
    """
    name = unicodedata.normalize('NFC', raw or '').strip()
    name = name.replace('\\', '/').split('/')[-1]          # 去掉任何路径部分
    name = re.sub(r'[\x00-\x1f<>:"|?*]', '', name)         # 控制字符与 Windows 非法字符
    name = name.lstrip('.')                                 # 防 .hidden 与 ..
    if not name or len(name) > 120:
        return None
    if Path(name).suffix.lower() not in ALLOWED_EXT:
        return None
    return name


class NoCacheHandler(SimpleHTTPRequestHandler):
    # 浏览器默认开 keep-alive 长连接。单线程 HTTPServer 下，一条长连接就能把
    # 整个服务独占住 —— 控制台 + 大屏 + 局域网另一台机器同时连，必然互相卡死
    # （现象：端口在监听，但所有请求超时、页面打不开）。改用 ThreadingHTTPServer
    # 之后每条连接各占一个线程，互不阻塞。
    protocol_version = 'HTTP/1.1'

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def _json(self, code, payload, close=False):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        # 出错时主动断开：请求体可能没读完（比如拒收一个 30MB 的文件），
        # 残留字节留在 keep-alive 连接里会被当成下一个请求的报文解析，
        # 后续请求全部错乱。实测就是这样把服务打到 ConnectionAborted 的。
        if close:
            self.send_header('Connection', 'close')
            self.close_connection = True
        self.end_headers()
        self.wfile.write(body)

    def _fail(self, code, msg):
        return self._json(code, {'ok': False, 'error': msg}, close=True)

    def do_POST(self):
        """POST /api/upload-image?name=xxx.png  —— 请求体就是文件原始字节。

        没用 multipart：那需要解析边界，而这里只传一个文件，直接发裸字节最省事，
        前端一行 fetch(url, {method:'POST', body: file}) 即可。
        """
        path = urllib.parse.urlparse(self.path)
        if path.path != '/api/upload-image':
            return self._fail(404, '未知接口')

        # 只允许本机上传。服务监听 0.0.0.0 是为了让局域网的大屏能访问，
        # 但「写文件」这件事不该对整个局域网开放 —— 大屏那边只读就够了。
        if self.client_address[0] not in ('127.0.0.1', '::1', 'localhost'):
            return self._fail(403, '只允许在本机上传')

        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return self._fail(400, '文件内容为空')
        if length > HARD_LIMIT:
            # 大到离谱就直接断，不值得为了报个错去收几百兆
            return self._fail(413, f'文件超过 {HARD_LIMIT // 1024 // 1024}MB，已拒收')

        # 先把请求体读干净，再做校验 —— 校验不通过也已经读完，连接可以干净地复用；
        # 不读就回错误会留下残字节（见 _json 的注释）。
        # 超限的也照读：本地回环几十兆是瞬间的事，换来的是浏览器那边能看到
        # 「文件超过 30MB」这句人话，而不是一个莫名其妙的「连接中断」。
        data = self.rfile.read(length)
        if len(data) > MAX_UPLOAD:
            return self._json(413, {'ok': False,
                                    'error': f'文件 {len(data)/1024/1024:.1f}MB，超过上限 '
                                             f'{MAX_UPLOAD // 1024 // 1024}MB，请先压缩'})

        qs = urllib.parse.parse_qs(path.query)
        name = safe_name((qs.get('name') or [''])[0])
        if not name:
            return self._fail(400, '文件名不合法，或不是图片（支持 png/jpg/jpeg/webp/gif/bmp）')
        IMAGES_DIR.mkdir(exist_ok=True)
        dest = IMAGES_DIR / name
        # 同名文件直接覆盖：换背景图就是要换掉，另存一份反而让人分不清用的是哪张
        try:
            dest.write_bytes(data)
        except OSError as e:
            return self._fail(500, f'写入失败：{e}')

        print(f'[upload] images/{name}  {len(data) / 1024:.0f} KB', flush=True)
        return self._json(200, {'ok': True, 'path': f'images/{name}',
                                'bytes': len(data)})

    def log_message(self, fmt, *args):
        # Windows 控制台默认 GBK，请求里带中文路径（如 images/图A.png）时
        # 默认的日志打印会抛 UnicodeEncodeError 把服务打挂。这里做兜底转义。
        try:
            super().log_message(fmt, *args)
        except Exception:
            pass


def lan_ip():
    """猜本机局域网 IP：不发包，只借 UDP socket 问内核走哪张网卡。取不到就回退 127.0.0.1。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    ip = lan_ip()
    print(f'比赛服务（禁缓存）已启动，监听 0.0.0.0:{port}')
    print(f'本机访问： http://localhost:{port}/index.html')
    print(f'同局域网其他电脑访问： http://{ip}:{port}/index.html')
    print('比赛全程请勿关闭本窗口。')
    try:
        srv = ThreadingHTTPServer(('0.0.0.0', port), NoCacheHandler)
        srv.daemon_threads = True      # 关窗口时不被残留连接卡住
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
