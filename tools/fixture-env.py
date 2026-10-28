from pathlib import Path
p=Path('.env.fixture')
if p.exists():
 print('Keeping existing .env.fixture')
else:
 text=Path('.env').read_text()
 for key,value in [('PREPARED_DB','data/prepared/fixture.sqlite'),('RAW_DIR','data/fixtures')]:
  text='\n'.join(key+'='+value if line.startswith(key+'=') else line for line in text.split('\n'))
 p.write_text(text);p.chmod(0o600);print('Created .env.fixture; secrets are not displayed')
