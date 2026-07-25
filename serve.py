#!/usr/bin/env python3
# 局域网静态服务：禁用浏览器缓存。
# 用途：改了 index.html / display.html / shared.js 后，浏览器普通刷新即拿到最新版本，
# 不会再出现「代码改了但页面还是旧逻辑（读题念下划线、多选点不动等）」。
# 监听 0.0.0.0，同一局域网内其他电脑也能用本机 IP 访问（控制台+大屏须开在同一浏览器里）。
# 用法：python serve.py [端口]   （默认 8080）
import socket
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


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
        HTTPServer(('0.0.0.0', port), NoCacheHandler).serve_forever()
    except KeyboardInterrupt:
        pass
