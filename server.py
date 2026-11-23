#!/usr/bin/env python3
"""Forger server: serves the game and runs Vs. matches. Standard library only.

    python3 server.py            # http://localhost:8642
    PORT=9000 python3 server.py

Vs. API (JSON):
    POST /api/create                         -> {code, player}
    POST /api/join   {code}                  -> {player}
    POST /api/score  {code, player, score}
    POST /api/leave  {code, player}
    GET  /api/events?code=&player=           -> server-sent events
Every event carries `now` (server ms) so clients can sync the match clock.
"""
import json
import os
import queue
import random
import secrets
import socket
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get('PORT', 8642))
MATCH_SECONDS = int(os.environ.get('FORGER_MATCH_SECONDS', 90))
COUNTDOWN_SECONDS = 3.5
RECONNECT_GRACE = 6          # seconds a dropped player has to reconnect
STALE_ROOM_SECONDS = 15 * 60

lock = threading.RLock()
rooms = {}


def now_ms():
    return int(time.time() * 1000)


class Player:
    def __init__(self, pid):
        self.id = pid
        self.score = 0
        self.queues = set()
        self.leave_timer = None


class Room:
    def __init__(self, code):
        self.code = code
        self.players = {}
        self.state = 'waiting'   # waiting | playing | done
        self.seed = 0
        self.start_at = 0
        self.end_at = 0
        self.created = time.time()


def send(room, msg, only=None):
    data = json.dumps(dict(msg, now=now_ms()))
    for p in room.players.values():
        if only is None or p.id == only:
            for q in list(p.queues):
                q.put(data)


def close_streams(room):
    for p in room.players.values():
        for q in list(p.queues):
            q.put(None)


def scores(room):
    return {p.id: p.score for p in room.players.values()}


def start_msg(room):
    return {'type': 'start', 'seed': room.seed, 'startAt': room.start_at, 'endAt': room.end_at}


def maybe_start(room):
    if room.state != 'waiting' or len(room.players) != 2:
        return
    if not all(p.queues for p in room.players.values()):
        return
    room.state = 'playing'
    room.seed = random.randint(1, 2 ** 31 - 1)
    room.start_at = now_ms() + int(COUNTDOWN_SECONDS * 1000)
    room.end_at = room.start_at + MATCH_SECONDS * 1000
    send(room, start_msg(room))
    t = threading.Timer((room.end_at - now_ms()) / 1000 + 0.75, finish, [room.code])
    t.daemon = True
    t.start()


def finish(code):
    with lock:
        room = rooms.get(code)
        if not room or room.state != 'playing':
            return
        room.state = 'done'
        send(room, {'type': 'end', 'scores': scores(room)})
        close_streams(room)
        rooms.pop(code, None)


def leave(code, pid):
    with lock:
        room = rooms.get(code)
        if not room or pid not in room.players:
            return
        if room.state == 'playing':
            send(room, {'type': 'left'})
            close_streams(room)
            rooms.pop(code, None)
        else:
            close_streams(room)
            rooms.pop(code, None)   # host left, or a waiting room emptied


def new_code():
    for _ in range(1000):
        code = f'{random.randint(1000, 9999)}'
        if code not in rooms:
            return code
    raise RuntimeError('no free codes')


def clean_stale():
    cutoff = time.time() - STALE_ROOM_SECONDS
    for code in [c for c, r in rooms.items() if r.created < cutoff]:
        close_streams(rooms[code])
        rooms.pop(code, None)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        if '/api/' not in (args[0] if args else ''):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = min(int(self.headers.get('Content-Length') or 0), 2048)
        try:
            return json.loads(self.rfile.read(n) or b'{}')
        except ValueError:
            return {}

    # ----- POST -----
    def do_POST(self):
        path = urlparse(self.path).path
        b = self.body()
        code, pid = str(b.get('code', '')), str(b.get('player', ''))

        if path == '/api/create':
            with lock:
                clean_stale()
                room = Room(new_code())
                player = Player(secrets.token_hex(8))
                room.players[player.id] = player
                rooms[room.code] = room
            return self.json(200, {'code': room.code, 'player': player.id})

        if path == '/api/join':
            with lock:
                room = rooms.get(code)
                if not room:
                    return self.json(404, {'error': 'No match with that code'})
                if room.state != 'waiting' or len(room.players) >= 2:
                    return self.json(409, {'error': 'That match is already full'})
                player = Player(secrets.token_hex(8))
                room.players[player.id] = player
            return self.json(200, {'code': code, 'player': player.id})

        if path == '/api/score':
            with lock:
                room = rooms.get(code)
                p = room and room.players.get(pid)
                if not p or room.state != 'playing' or now_ms() > room.end_at + 1500:
                    return self.json(409, {'error': 'Match is not running'})
                try:
                    p.score = max(0, min(10 ** 6, int(b.get('score', 0))))
                except (TypeError, ValueError):
                    return self.json(400, {'error': 'Bad score'})
                send(room, {'type': 'score', 'scores': scores(room)})
            return self.json(200, {'ok': True})

        if path == '/api/leave':
            leave(code, pid)
            return self.json(200, {'ok': True})

        self.json(404, {'error': 'Not found'})

    # ----- GET -----
    def do_GET(self):
        url = urlparse(self.path)
        if url.path != '/api/events':
            return super().do_GET()

        qs = parse_qs(url.query)
        code, pid = qs.get('code', [''])[0], qs.get('player', [''])[0]
        q = queue.Queue()
        with lock:
            room = rooms.get(code)
            player = room and room.players.get(pid)
            if not player:
                return self.json(404, {'error': 'Match not found'})
            if player.leave_timer:
                player.leave_timer.cancel()
                player.leave_timer = None
            player.queues.add(q)
            q.put(json.dumps({'type': 'joined', 'code': code, 'players': len(room.players), 'now': now_ms()}))
            if room.state == 'playing':                     # reconnect mid-match
                q.put(json.dumps(dict(start_msg(room), now=now_ms())))
                q.put(json.dumps({'type': 'score', 'scores': scores(room), 'now': now_ms()}))
            else:
                send(room, {'type': 'joined', 'code': code, 'players': len(room.players)})
            maybe_start(room)

        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        try:
            while True:
                try:
                    item = q.get(timeout=15)
                except queue.Empty:
                    self.wfile.write(b': ping\n\n')
                    self.wfile.flush()
                    continue
                if item is None:
                    break
                self.wfile.write(f'data: {item}\n\n'.encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with lock:
                player.queues.discard(q)
                if not player.queues and rooms.get(code) is room and room.state != 'done':
                    t = threading.Timer(RECONNECT_GRACE, lambda: (not player.queues) and leave(code, pid))
                    t.daemon = True
                    player.leave_timer = t
                    t.start()


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))   # no packets sent; just picks the outgoing interface
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


if __name__ == '__main__':
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    server.daemon_threads = True
    print(f'Forger running at http://localhost:{PORT}')
    ip = lan_ip()
    if ip:
        print(f'Players on your network can join at http://{ip}:{PORT}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
