"""Create local secrets without printing them or replacing an existing environment."""
from pathlib import Path
import os, secrets
p = Path('.env')
text = Path('.env.example').read_text()
for key in ['MYSQL_PASSWORD', 'MYSQL_ROOT_PASSWORD', 'ADMIN_TOKEN', 'DEVICE_TOKEN']:
    text = text.replace(key+'=\n', key+'='+secrets.token_hex(32)+'\n')
fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write(text)
print('Created .env (0600); existing files are never overwritten.')
