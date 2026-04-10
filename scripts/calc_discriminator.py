#!/usr/bin/env python3
"""Anchor discriminator calculator."""

import hashlib
import sys


def instruction(name: str) -> list[int]:
    return list(hashlib.sha256(f"global:{name}".encode()).digest()[:8])


def account(name: str) -> list[int]:
    return list(hashlib.sha256(f"account:{name}".encode()).digest()[:8])


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: calc_discriminator.py [instruction|account] <name>")
        sys.exit(1)

    kind, name = sys.argv[1], sys.argv[2]
    if kind == "instruction":
        print(instruction(name))
    elif kind == "account":
        print(account(name))
    else:
        print("Usage: calc_discriminator.py [instruction|account] <name>")
        sys.exit(1)
