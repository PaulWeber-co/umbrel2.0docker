"""Host console client. Shares the button's approved-release-only contract."""
import argparse
import http.client
import json
import socket
import time


def send_request(socket_path, method, path):
    connection = http.client.HTTPConnection('localhost', timeout=10)
    connection.sock = socket.socket(socket.AF_UNIX)
    connection.sock.settimeout(10); connection.sock.connect(socket_path)
    try:
        connection.request(method, path, body='{}' if method == 'POST' else None,
                           headers={'Content-Type':'application/json'})
        response = connection.getresponse(); data = response.read(1024*1024+1)
        if len(data) > 1024*1024: raise ValueError('Oversized updater response')
        result = json.loads(data)
        if not 200 <= response.status < 300: raise RuntimeError(result.get('error', 'Updater request failed'))
        return result
    finally: connection.close()


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['update','status','check'])
    parser.add_argument('--wait', action='store_true'); args = parser.parse_args()
    sock = '/run/xps-umbrel-updater/control.sock'
    if args.action != 'update':
        print(json.dumps(send_request(sock, 'GET', '/v1/status' if args.action == 'status' else '/v1/release'))); return
    release = send_request(sock, 'GET', '/v1/release')
    if not release['available']:
        print('No newer approved XPS image available'); return
    job = send_request(sock, 'POST', '/v1/update'); print('Update job:', job['jobId'], flush=True)
    if not args.wait: return
    deadline = time.monotonic()+10800
    while time.monotonic() < deadline:
        status = send_request(sock, 'GET', '/v1/status')
        if status['jobId'] != job['jobId']: raise RuntimeError('Unexpected update job')
        if status['phase'] == 'finished':
            print(json.dumps(status)); raise SystemExit(0 if status['outcome'] == 'succeeded' else 1)
        time.sleep(5)
    raise TimeoutError('Update still running; inspect persistent host status')


if __name__ == '__main__': main()
