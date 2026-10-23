#!/usr/bin/env python3
"""Losslessly split OOXML slides and produce the web presentation manifest.

Uses only the Python standard library. Slide XML and dependencies are copied
without reconstructing shapes, text, animations, charts, themes or media.
"""
import argparse
import json
import posixpath
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
ET.register_namespace('p', P)
ET.register_namespace('a', A)
ET.register_namespace('r', R)


def xml(root):
    # Some presentation readers sniff package XML using its default namespace.
    if root.tag.startswith('{' + REL + '}'):
        ET.register_namespace('', REL)
    elif root.tag.startswith('{' + CT + '}'):
        ET.register_namespace('', CT)
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)


def target_path(part, target):
    return posixpath.normpath(posixpath.join(posixpath.dirname(part), target)) if not target.startswith('/') else target.lstrip('/')


def rels_path(part):
    folder, name = posixpath.split(part)
    return posixpath.join(folder, '_rels', name + '.rels') if part else '_rels/.rels'


def reachable_parts(files):
    keep, pending = set(), ['']
    while pending:
        part = pending.pop()
        if part:
            if part in keep:
                continue
            if part not in files:
                raise ValueError(f'Missing package part: {part}')
            keep.add(part)
        relfile = rels_path(part)
        if relfile not in files:
            continue
        keep.add(relfile)
        for rel in ET.fromstring(files[relfile]):
            if rel.get('TargetMode') != 'External':
                pending.append(target_path(part, rel.get('Target')))
    return keep


def split(source):
    with ZipFile(source) as archive:
        original = {n: archive.read(n) for n in archive.namelist() if not n.endswith('/')}
    presentation = ET.fromstring(original['ppt/presentation.xml'])
    slide_ids = list(presentation.find(f'{{{P}}}sldIdLst'))
    relations = ET.fromstring(original['ppt/_rels/presentation.xml.rels'])
    slide_paths = {rel.get('Id'): target_path('ppt/presentation.xml', rel.get('Target')) for rel in relations if rel.get('Type').endswith('/slide')}
    size = presentation.find(f'{{{P}}}sldSz')
    manifest = {'title': '从你的创意到个性化硬件', 'width': int(size.get('cx')), 'height': int(size.get('cy')), 'source': str(source.relative_to(ROOT)), 'slides': []}
    (ROOT / 'slides').mkdir(exist_ok=True)
    for number, selected in enumerate(slide_ids, 1):
        files = dict(original)
        current = ET.fromstring(original['ppt/presentation.xml'])
        ids = current.find(f'{{{P}}}sldIdLst')
        for item in list(ids):
            if item.get(f'{{{R}}}id') != selected.get(f'{{{R}}}id'):
                ids.remove(item)
        # Custom shows and section lists contain IDs of removed slides.
        for child in list(current):
            if child.tag in (f'{{{P}}}custShowLst', f'{{{P}}}extLst'):
                current.remove(child)
        files['ppt/presentation.xml'] = xml(current)
        rels = ET.fromstring(original['ppt/_rels/presentation.xml.rels'])
        for rel in list(rels):
            if rel.get('Type').endswith('/slide') and rel.get('Id') != selected.get(f'{{{R}}}id'):
                rels.remove(rel)
        files['ppt/_rels/presentation.xml.rels'] = xml(rels)
        if 'docProps/app.xml' in files:
            props = ET.fromstring(files['docProps/app.xml'])
            for prop in props:
                if prop.tag.endswith('}Slides'):
                    prop.text = '1'
                if prop.tag.endswith(('}TitlesOfParts', '}HeadingPairs')):
                    props.remove(prop)
            files['docProps/app.xml'] = xml(props)
        keep = reachable_parts(files)
        types = ET.fromstring(original['[Content_Types].xml'])
        for item in list(types):
            if item.tag == f'{{{CT}}}Override' and item.get('PartName').lstrip('/') not in keep:
                types.remove(item)
        files['[Content_Types].xml'] = xml(types)
        keep.add('[Content_Types].xml')
        name = f'slide-{number:02d}'
        with ZipFile(ROOT / 'slides' / f'{name}.pptx', 'w', ZIP_DEFLATED) as archive:
            for part in sorted(keep):
                archive.writestr(part, files[part])
        slide_path = slide_paths[selected.get(f'{{{R}}}id')]
        text = [node.text for node in ET.fromstring(original[slide_path]).iter(f'{{{A}}}t') if node.text]
        manifest['slides'].append({'number': number, 'title': ''.join(text[:2]), 'text': text, 'image': f'assets/previews/{name}.png', 'pptx': f'slides/{name}.pptx'})
        print(f'{name}.pptx')
    # Hand-written navigation titles remain independent of the original copy.
    titles = ['从你的创意到个性化硬件', '用户正在改写音乐设备', '203 接近十年的准备', 'MatrixOS 开放系统', '原生开放开发的基础', 'Demo', '演示一：和弦涟漪', '演示二：在浏览器里运行', '203 的产品与下一步', '更多创意，合适的硬件', 'You will own everything']
    if len(titles) == len(manifest['slides']):
        for slide, title in zip(manifest['slides'], titles):
            slide['title'] = title
    (ROOT / 'slides.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', nargs='?', type=Path)
    args = parser.parse_args()
    source = args.source.resolve() if args.source else next((ROOT / 'source').glob('*.pptx'))
    split(source)
