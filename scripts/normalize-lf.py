"""
mint - build-time guard.

1. Force LF endings on every text asset the theme ships (shell, python,
   ucode templates, JS, CSS, po, Makefile, json). CRLF breaks BusyBox
   ash scripts and procd inits at run time, so it must never reach the
   router.
2. Run a brace/paren balance check over every CSS file so a malformed
   layer is caught before packaging.

Usage:  python scripts/normalize-lf.py [repo-root]
"""
import os
import sys

TEXT_EXT = {
    '.css', '.js', '.uc', '.ut', '.sh', '.py', '.po', '.pot', '.json',
    '.md', '.txt', '.yml', '.yaml',
}
TEXT_NAMES = {
    'Makefile', 'README', 'LICENSE', 'CHANGELOG', 'RELEASE',
    '.gitattributes', '.gitignore',
}
# Files that must always be LF regardless of extension.
FORCE_NAMES = {
    '30_luci-theme-mint',
    '30_luci-app-mint-wallpaper',
    'mint',                 # rpcd exec
    'mz-wallpaper-fetch.sh',
}
SKIP_DIRS = {'.git', 'node_modules', '.workbuddy', '__pycache__'}


def is_text(path):
    name = os.path.basename(path)
    if name in TEXT_NAMES or name in FORCE_NAMES:
        return True
    return os.path.splitext(name)[1].lower() in TEXT_EXT


def fix(path):
    with open(path, 'rb') as fh:
        raw = fh.read()
    if b'\r\n' not in raw and b'\r' not in raw:
        return False
    fixed = raw.replace(b'\r\n', b'\n').replace(b'\r', b'\n')
    with open(path, 'wb') as fh:
        fh.write(fixed)
    return True


def check_css(path):
    """Return a list of problems: unbalanced braces or a stray quote."""
    with open(path, 'r', encoding='utf-8', errors='replace') as fh:
        s = fh.read()
    problems = []
    depth = 0
    i = 0
    n = len(s)
    in_comment = False
    while i < n:
        c = s[i]
        if in_comment:
            if s.startswith('*/', i):
                in_comment = False
                i += 2
                continue
            i += 1
            continue
        if s.startswith('/*', i):
            in_comment = True
            i += 2
            continue
        if c in ('"', "'"):
            q = c
            i += 1
            while i < n and s[i] != q:
                if s[i] == '\\':
                    i += 1
                i += 1
            i += 1
            continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth < 0:
                problems.append('unmatched } near offset %d' % i)
                depth = 0
        i += 1
    if depth != 0:
        problems.append('unbalanced braces: depth %d at EOF' % depth)
    return problems


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))
    converted = []
    css_problems = []

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            p = os.path.join(dirpath, fn)
            if not is_text(p):
                continue
            if fix(p):
                converted.append(os.path.relpath(p, root))
            if fn.endswith('.css'):
                probs = check_css(p)
                for m in probs:
                    css_problems.append('%s: %s' % (os.path.relpath(p, root), m))

    if converted:
        print('CRLF -> LF converted (%d):' % len(converted))
        for c in converted:
            print('  ', c)
    else:
        print('CRLF -> LF: all files already LF')

    if css_problems:
        print('CSS BALANCE ERRORS:')
        for m in css_problems:
            print('  ', m)
        return 1

    print('CSS balance check: OK')
    return 0


if __name__ == '__main__':
    sys.exit(main())
