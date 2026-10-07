"""Short-code generation.

Codes are 8 random characters from a 56-symbol alphabet that leaves out
look-alikes (0/O/o, 1/l/I), so a code read off a slide or a printed QR label
can be typed back without guessing. 56^8 ~= 9.7e13 possible codes; a collision
is still handled by the unique index + retry loop in the create endpoint.
"""
import re
import secrets

ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz"
CODE_LENGTH = 8

# Never usable as a code: they'd collide with routes or look official.
RESERVED = frozenset(
    {
        "api", "app", "healthz", "readyz", "metrics", "docs", "redoc", "openapi.json",
        "admin", "static", "assets", "login", "settings", "links", "stats",
    }
)

ALIAS_RE = re.compile(r"^[A-Za-z0-9_-]{3,32}$")


def generate_code(length: int = CODE_LENGTH) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def is_valid_alias(alias: str) -> bool:
    # fullmatch: with re.match, '$' also matches right before a trailing newline
    return bool(ALIAS_RE.fullmatch(alias)) and alias.lower() not in RESERVED
