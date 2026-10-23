#!/usr/bin/env python3
"""Render each single-slide PPTX via LibreOffice PDF and Poppler.

Requires soffice, pdftoppm and the original presentation fonts.
Extra font folders can be supplied with --font-dir.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--soffice', default='soffice')
parser.add_argument('--pdftoppm', default='pdftoppm')
parser.add_argument('--font-dir', action='append', default=[])
args = parser.parse_args()
manifest = json.loads((ROOT / 'slides.json').read_text())
with tempfile.TemporaryDirectory(prefix='hardware-talk-previews-') as tmp:
    work = Path(tmp)
    config = ET.Element('fontconfig')
    folders = [Path.home() / 'Library/Fonts', Path('/Library/Fonts'), Path('/System/Library/Fonts'), Path('/System/Library/Fonts/Supplemental'), Path.home() / '.local/share/fonts', Path('/usr/share/fonts')]
    folders.extend(Path(folder).resolve() for folder in args.font_dir)
    for folder in folders:
        if folder.is_dir():
            ET.SubElement(config, 'dir').text = str(folder)
    ET.SubElement(config, 'cachedir').text = str(work / 'font-cache')
    fontconfig = work / 'fonts.conf'
    ET.ElementTree(config).write(fontconfig, encoding='utf-8', xml_declaration=True)
    environment = dict(os.environ, FONTCONFIG_FILE=str(fontconfig))
    subprocess.run([args.soffice, '-env:UserInstallation=' + (work / 'profile').as_uri(), '--headless', '--convert-to', 'pdf', '--outdir', tmp, *[str(ROOT / slide['pptx']) for slide in manifest['slides']]], env=environment, check=True)
    for slide in manifest['slides']:
        pdf = work / (Path(slide['pptx']).stem + '.pdf')
        if not pdf.is_file():
            raise RuntimeError(f'LibreOffice did not generate {pdf.name}')
        destination = ROOT / slide['image']
        destination.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([args.pdftoppm, '-scale-to', '1920', '-singlefile', '-png', str(pdf), str(destination.with_suffix(''))], check=True)
        print(destination.relative_to(ROOT), flush=True)
