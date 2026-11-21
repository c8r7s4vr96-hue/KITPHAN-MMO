from pathlib import Path
from bs4 import BeautifulSoup
import subprocess
root=Path(__file__).resolve().parents[1]
for script in list(root.glob('api/*.js'))+list(root.glob('lib/*.js')):
    run=subprocess.run(['node','--check',str(script)],capture_output=True,text=True)
    assert run.returncode==0,(str(script),run.stderr)
for name in ['index.html','admin-shop.html']:
    for i,tag in enumerate(BeautifulSoup((root/name).read_text(),'html.parser').find_all('script')):
        if tag.get('src') or not tag.text.strip():continue
        temp=Path('/tmp')/f'kp_v5_{name}_{i}.js';temp.write_text(tag.text)
        run=subprocess.run(['node','--check',str(temp)],capture_output=True,text=True)
        assert run.returncode==0,(str(temp),run.stderr)
print('PASS server and inline JavaScript syntax')
