import { Access } from './access.js';
import { mkdirSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';

const access = new Access(resolve('.local/access.sqlite'));
const [command, id, values, subject, oauthScopes] = process.argv.slice(2);
function deliver(token) {
  mkdirSync('.local/credentials', { recursive: true, mode: 0o700 });
  chmodSync('.local/credentials', 0o700);
  const file = resolve(`.local/credentials/${id}.token`), temporary = `${file}.tmp`;
  writeFileSync(temporary, token + '\n', { mode: 0o600 }); chmodSync(temporary, 0o600);
  renameSync(temporary, file);
  console.log(`凭据已保存到 .local/credentials/${id}.token；请安全配置客户端。喵～`);
}
try {
  if (command === 'create') deliver(access.add(id, values || 'read'));
  else if (command === 'oauth-add') {
    access.add(id, oauthScopes || 'read', { issuer: process.env.MYFAV_OAUTH_ISSUER, clientId: values, subject });
    console.log('OAuth Agent 已注册；只有匹配客户端、用户和 scope 的令牌可访问。喵～');
  } else if (command === 'rotate') deliver(access.rotate(id));
  else if (command === 'revoke') { access.revoke(id); console.log('Agent 已撤销，后续请求失效。喵～'); }
  else if (command === 'scopes') { access.setScopes(id, values); console.log('权限已更新。喵～'); }
  else if (command === 'list') console.log(JSON.stringify(access.list(), null, 2));
  else if (command === 'audit') console.log(JSON.stringify(access.audits(id), null, 2));
  else throw Error();
} catch { console.error('凭据操作失败，请检查命令、Agent ID、权限或 OAuth 身份；不会输出秘密。喵～'); process.exitCode = 1; }
finally { access.close(); }
