import {generateKeyPairSync, createPrivateKey, createPublicKey, sign} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keyPath = resolve(root, '.automation/progress-key.pem');
if (process.argv[2] === 'init') {
  mkdirSync(dirname(keyPath), {recursive:true, mode:0o700});
  if (!existsSync(keyPath)) {
    const {privateKey} = generateKeyPairSync('ed25519');
    writeFileSync(keyPath, privateKey.export({type:'pkcs8',format:'pem'}), {mode:0o600, flag:'wx'});
  }
  const configPath = resolve(root, 'collaboration-config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.progressPublicKey = createPublicKey(readFileSync(keyPath)).export({format:'jwk'});
  writeFileSync(configPath, JSON.stringify(config,null,2)+'\n');
  console.log('Progress verification public key configured; private key stays local.');
} else {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const privateKey = createPrivateKey(readFileSync(keyPath));
  const config = JSON.parse(readFileSync(resolve(root,'collaboration-config.json'),'utf8'));
  if (createPublicKey(privateKey).export({format:'jwk'}).x !== config.progressPublicKey?.x) throw new Error('Progress key does not match the configured public key');
  const payload = Buffer.from(input);
  console.log(JSON.stringify({type:'203-ai-progress/v1',payload:payload.toString('base64url'),signature:sign(null,payload,privateKey).toString('base64url')}));
}
