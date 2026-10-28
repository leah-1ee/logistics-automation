"""Read-only pre-push audit; prints locations/rules, never matched credential values.
Checks reachable history and tracked/non-ignored worktree files. This is a bounded
pattern and exact-local-secret check, not a guarantee against every form of PII.
"""
from pathlib import Path
import argparse, json, re, subprocess, sys

def git(*args):
    return subprocess.check_output(['git', *args])

def audit():
    secrets = []
    for path in Path('.').glob('.env*'):
        if path.name == '.env.example':
            continue
        for line in path.read_text().splitlines():
            if '=' not in line or line.lstrip().startswith('#'):
                continue
            key, value = line.split('=', 1)
            if re.search(r'PASSWORD|TOKEN|SECRET|PRIVATE_KEY', key, re.I) and len(value.strip()) >= 8:
                secrets.append((key, value.strip().encode()))
    rules = [
        ('github_token', rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b'),
        ('private_key', rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
        ('aws_access_key', rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
        ('credential_url', rb'(?:mysql|postgres(?:ql)?|redis)://[^\s/:]+:[^\s/@]+@'),
        ('kaggle_key', rb'"key"\s*:\s*"[a-f0-9]{32}"'),
        ('personal_contact_field', rb'"(?:customer_email|customer_phone|cpf|private_email)"\s*:\s*"[^"\s]{5,}"'),
    ]
    findings = []
    forbidden = []
    def inspect(scope, path, data, oid=None):
        location = {'scope': scope, 'path': path, **({'object': oid} if oid else {})}
        for key, value in secrets:
            if value in data:
                findings.append({**location, 'rule': 'exact_local_secret', 'key': key})
        for label, pattern in rules:
            if re.search(pattern, data):
                findings.append({**location, 'rule': label})
        if (re.match(r'(?:data|var|dist|node_modules|\.tools)/', path)
            or (path.startswith('.env') and path != '.env.example')
            or path.endswith(('.csv', '.zip', '.sqlite', '.sqlite-wal', '.tgz', '.tar.gz', '.tar.xz', '.map', '.exe'))):
            forbidden.append(location)
    historical = 0
    for line in git('rev-list', '--objects', '--all').decode().splitlines():
        oid, _, path = line.partition(' ')
        if git('cat-file', '-t', oid).strip() != b'blob':
            continue
        historical += 1
        inspect('history', path, git('cat-file', 'blob', oid), oid)
    paths = sorted(set(p.decode() for p in git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split(b'\0') if p))
    for path in paths:
        if Path(path).is_file():
            inspect('worktree', path, Path(path).read_bytes())
    return {
        'status': 'FAIL' if findings or forbidden else 'PASS',
        'scope': 'reachable Git history and tracked/non-ignored worktree candidates; bounded pattern/exact-secret audit',
        'head': git('rev-parse', 'HEAD').decode().strip(),
        'historicalBlobCount': historical, 'candidateFileCount': len(paths),
        'localSecretEntriesChecked': len(secrets),
        'findings': findings, 'forbiddenPaths': forbidden,
        'limitations': 'Manual review is still required for arbitrary prose/PII. Generated examples and synthetic manifests are not Olist originals. Git author metadata is preserved.',
    }

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--report')
    args = parser.parse_args()
    result = audit()
    output = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.report:
        Path(args.report).write_text(output)
    print(output, end='')
    sys.exit(0 if result['status'] == 'PASS' else 1)
