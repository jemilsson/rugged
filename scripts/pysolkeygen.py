#!/usr/bin/env python3
"""Pure-stdlib Ed25519 keypair generator producing Solana-compatible
JSON keyfiles (array of 64 bytes: 32-byte seed || 32-byte pubkey),
plus base58 pubkey printing. Fallback for when solana-keygen (via Nix)
is unavailable or a source build is too slow. No third-party deps.
"""
import hashlib
import json
import os
import sys

b = 256
q = 2**255 - 19
l = 2**252 + 27742317777372353535851937790883648493


def H(m):
    return hashlib.sha512(m).digest()


def inv(x):
    return pow(x, q - 2, q)


d = -121665 * inv(121666) % q
I = pow(2, (q - 1) // 4, q)


def xrecover(y):
    xx = (y * y - 1) * inv(d * y * y + 1)
    x = pow(xx, (q + 3) // 8, q)
    if (x * x - xx) % q != 0:
        x = (x * I) % q
    if x % 2 != 0:
        x = q - x
    return x


By = 4 * inv(5)
Bx = xrecover(By)
B = (Bx % q, By % q)


def edwards(P, Q):
    x1, y1 = P
    x2, y2 = Q
    x3 = (x1 * y2 + x2 * y1) * inv(1 + d * x1 * x2 * y1 * y2)
    y3 = (y1 * y2 + x1 * x2) * inv(1 - d * x1 * x2 * y1 * y2)
    return (x3 % q, y3 % q)


def scalarmult(P, e):
    if e == 0:
        return (0, 1)
    Q = scalarmult(P, e // 2)
    Q = edwards(Q, Q)
    if e & 1:
        Q = edwards(Q, P)
    return Q


def encodepoint(P):
    x, y = P
    ba = bytearray(y.to_bytes(32, "little"))
    if x & 1:
        ba[31] |= 0x80
    return bytes(ba)


def bit(h, i):
    return (h[i // 8] >> (i % 8)) & 1


def publickey(sk):
    h = H(sk)
    a = 2 ** (b - 2) + sum(2**i * bit(h, i) for i in range(3, b - 2))
    A = scalarmult(B, a)
    return encodepoint(A)


ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58encode(data):
    n = int.from_bytes(data, "big")
    out = ""
    while n > 0:
        n, rem = divmod(n, 58)
        out = ALPHABET[rem] + out
    pad = 0
    for byte in data:
        if byte == 0:
            pad += 1
        else:
            break
    return ALPHABET[0] * pad + out


def gen_keyfile(path):
    seed = os.urandom(32)
    pub = publickey(seed)
    keypair = list(seed) + list(pub)
    with open(path, "w") as f:
        json.dump(keypair, f)
    return b58encode(pub)


def pubkey_of(path):
    with open(path) as f:
        arr = json.load(f)
    pub = bytes(arr[32:64])
    return b58encode(pub)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "new":
        print(gen_keyfile(sys.argv[2]))
    elif cmd == "pubkey":
        print(pubkey_of(sys.argv[2]))
