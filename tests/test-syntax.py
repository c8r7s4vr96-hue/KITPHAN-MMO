from html.parser import HTMLParser
from pathlib import Path
import subprocess


class InlineScripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inside = False
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            self.inside = not dict(attrs).get('src')
            if self.inside:
                self.scripts.append('')

    def handle_data(self, data):
        if self.inside:
            self.scripts[-1] += data

    def handle_endtag(self, tag):
        if tag == 'script':
            self.inside = False


root = Path(__file__).resolve().parents[1]
for folder in ['api', 'lib']:
    for path in sorted((root / folder).glob('*.js')):
        subprocess.run(['node', '--check', str(path)], check=True)

pages = [*sorted(root.glob('*.html')), root / 'public/index.html',
         root / 'tests/thu-locket-offline.html']
for page in pages:
    parser = InlineScripts()
    parser.feed(page.read_text(encoding='utf-8'))
    parser.close()
    for index, script in enumerate(parser.scripts, start=1):
        if script.strip():
            result = subprocess.run(['node', '--check'], input=script, text=True)
            if result.returncode:
                raise SystemExit(f'{page.name}: inline script {index} failed')
print('PASS server and inline JavaScript syntax')
