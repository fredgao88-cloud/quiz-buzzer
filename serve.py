#!/usr/bin/env python3
# 本机静态服务：禁用浏览器缓存。
# 用途：改了 index.html / display.html / shared.js 后，浏览器普通刷新即拿到最新版本，
# 不会再出现「代码改了但页面还是旧逻辑（读题念下划线、多选点不动等）」。
# 用法：python serve.py [端口]   （默认 8080，只监听本机 127.0.0.1）
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f'比赛服务（禁缓存）已启动： http://localhost:{port}/index.html')
    print('比赛全程请勿关闭本窗口。')
    try:
        HTTPServer(('127.0.0.1', port), NoCacheHandler).serve_forever()
    except KeyboardInterrupt:
        pass
