#!/usr/bin/env python3
"""Check package integrity, slide fidelity, dimensions and web asset coverage."""
import json
from pathlib import Path
import struct
import xml.etree.ElementTree as ET
from zipfile import ZipFile
from split_pptx import P, R, REL, target_path, reachable_parts

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'slides.json').read_text())
with ZipFile(ROOT / manifest['source']) as archive:
    original = {name: archive.read(name) for name in archive.namelist() if not name.endswith('/')}
presentation = ET.fromstring(original['ppt/presentation.xml'])
original_ids = list(presentation.find(f'{{{P}}}sldIdLst'))
original_rels = {rel.get('Id'): target_path('ppt/presentation.xml', rel.get('Target')) for rel in ET.fromstring(original['ppt/_rels/presentation.xml.rels'])}
assert len(manifest['slides']) == len(original_ids), 'Slide count changed'
for slide, source_id in zip(manifest['slides'], original_ids):
    with ZipFile(ROOT / slide['pptx']) as archive:
        assert archive.testzip() is None, 'Corrupt archive'
        files = {name: archive.read(name) for name in archive.namelist() if not name.endswith('/')}
    reachable_parts(files)  # Fails on any broken internal relationship.
    for name, data in files.items():
        if name.endswith(('.xml', '.rels')):
            ET.fromstring(data)
        if name not in {'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels', '[Content_Types].xml', 'docProps/app.xml'}:
            assert data == original[name], f'Changed original part: {name}'
    current = ET.fromstring(files['ppt/presentation.xml'])
    ids = list(current.find(f'{{{P}}}sldIdLst'))
    assert len(ids) == 1 and ids[0].attrib == source_id.attrib, 'Unexpected slide selection'
    assert len([n for n in files if n.startswith('ppt/slides/slide') and n.endswith('.xml')]) == 1, 'Extra slide copied'
    size = current.find(f'{{{P}}}sldSz')
    assert [int(size.get('cx')), int(size.get('cy'))] == [manifest['width'], manifest['height']], 'Changed aspect ratio'
    source_slide = original_rels[source_id.get(f'{{{R}}}id')]
    assert files[source_slide] == original[source_slide], 'Changed slide content'
    image = (ROOT / slide['image']).read_bytes()
    assert image[:8] == b'\x89PNG\r\n\x1a\n', 'Preview is not PNG'
    width, height = struct.unpack('>II', image[16:24])
    assert abs(width / height - manifest['width'] / manifest['height']) < .01, 'Preview aspect ratio mismatch'
    assert width >= 1600, 'Preview resolution too low'
    print(f"OK {slide['number']:02d}: one editable slide, original XML and dependencies, {width}×{height} preview")
print(f"Validated {len(manifest['slides'])} slides, aspect ratio {manifest['width']}:{manifest['height']}.")
