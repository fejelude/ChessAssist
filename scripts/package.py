#!/usr/bin/env python3
"""Package the complete installable extension and source, excluding local tooling."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
exclude = {'node_modules', 'test-results', '.git', '__pycache__', 'releases'}
paths = sorted(p for p in root.rglob('*') if p.is_file() and not any(part in exclude for part in p.relative_to(root).parts) and p.name != 'SHA256SUMS.txt')
checksums = '\n'.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(root).as_posix()}' for p in paths) + '\n'
(root / 'SHA256SUMS.txt').write_text(checksums)
version = json.loads((root / 'package.json').read_text())['version']
release = root / 'releases' / f'ChessAssist-{version}.zip'
release.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(release, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in [*paths, root / 'SHA256SUMS.txt']:
        archive.write(path, Path('ChessAssist') / path.relative_to(root))
with zipfile.ZipFile(release) as archive:
    assert archive.testzip() is None
    assert 'ChessAssist/dist/manifest.json' in archive.namelist()
    assert 'ChessAssist/dist/engine/stockfish.wasm' in archive.namelist()
print(f'{release} ({release.stat().st_size:,} bytes; {len(paths)+1} files)')
