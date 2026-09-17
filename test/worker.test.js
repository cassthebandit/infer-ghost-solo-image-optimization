import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../infer-image-optimizer.js', import.meta.url), 'utf8');
function runtime(response) {
  const calls = [];
  const context = vm.createContext({URL, Request, Response, fetch: async request => {calls.push(request); return response;}, HTMLRewriter: class {
    on() {return this;} transform(value) {return value;}
  }});
  vm.runInContext(source.replace('export default {', 'globalThis.worker = {'), context);
  return {context, calls, worker: context.worker};
}
for (const [name, path, method] of [
  ['admin', '/ghost/api/admin/themes/upload/', 'POST'],
  ['image transform', '/cdn-cgi/image/width=300/content/images/test.jpg', 'GET'],
  ['media range', '/content/media/test.mp4', 'GET'],
  ['member request', '/members/api/send-magic-link/', 'POST']
]) {
  test(name + ' preserves the request and response', async () => {
    const response = new Response('bytes', {status:206,headers:{'Content-Range':'bytes 0-4/20'}});
    const r=runtime(response);
    const request=new Request('https://infer.blog'+path,{method,headers:{Range:'bytes=0-4','Accept-Encoding':'identity'}});
    assert.equal(await r.worker.fetch(request),response);
    assert.equal(r.calls.length,1); assert.equal(r.calls[0].url,request.url);
    assert.equal(r.calls[0].method,request.method);
    assert.equal(r.calls[0].headers.get('Range'),'bytes=0-4');
  });
}
test('origin failure is preserved', async () => {
  const response=new Response('unavailable',{status:503}); const r=runtime(response);
  assert.equal(await r.worker.fetch(new Request('https://infer.blog/')),response);
});
test('responsive images use original image and descriptor width', () => {
  const r=runtime(null);
  assert.equal(vm.runInContext('rewriteSrcset("/content/images/size/w600/2026/a.jpg 300w, /content/images/size/w1200/2026/a.jpg 900w")',r.context),
    '/cdn-cgi/image/format=auto,quality=80,fit=scale-down,width=300,onerror=redirect/content/images/2026/a.jpg 300w, /cdn-cgi/image/format=auto,quality=80,fit=scale-down,width=900,onerror=redirect/content/images/2026/a.jpg 900w');
});

for (const method of ['GET', 'HEAD']) {
  test(method + ' public HTML gets compatible enforcing baseline headers', async () => {
    const original = new Response(method === 'HEAD' ? null : '<html>hello</html>', {headers:{'content-type':'text/html', 'cache-control':'public, max-age=60'}});
    const r = runtime(original);
    const result = await r.worker.fetch(new Request('https://infer.blog/', {method}));
    assert.equal(result.headers.get('strict-transport-security'), 'max-age=31536000');
    assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(result.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(result.headers.get('cache-control'), 'public, max-age=60');
    assert.equal(result.headers.has('content-security-policy-report-only'), false);
    const policy=result.headers.get('content-security-policy');
    assert.ok(policy.includes("object-src 'none'"));
    assert.ok(policy.includes('https://cdn.jsdelivr.net'));
    assert.ok(policy.includes('https://static.cloudflareinsights.com'));
    assert.equal(await result.text(), method === 'HEAD' ? '' : '<html>hello</html>');
  });
}

for (const path of ['/ghost/api/admin/session/', '/members/api/send-magic-link/', '/content/media/test.mp4', '/']) {
  test('trusted client IP replaces spoofed forwarding chain on ' + path, async () => {
    const r=runtime(new Response('ok'));
    const request=new Request('https://infer.blog'+path, {method:'POST',body:'preserved-body',headers:{
      'CF-Connecting-IP':'2001:db8::1234','X-Forwarded-For':'192.0.2.123,198.51.100.10',
      'X-Real-IP':'192.0.2.124','Content-Type':'text/plain','Cookie':'test=value','Authorization':'Bearer synthetic-test'
    }});
    await r.worker.fetch(request);
    const forwarded=r.calls[0];
    assert.equal(forwarded.headers.get('X-Forwarded-For'),'2001:db8::1234');
    assert.equal(forwarded.headers.get('X-Real-IP'),'2001:db8::1234');
    assert.equal(forwarded.headers.get('Cookie'),'test=value');
    assert.equal(forwarded.headers.get('Authorization'),'Bearer synthetic-test');
    assert.equal(await forwarded.text(),'preserved-body');
    assert.equal(request.headers.get('X-Forwarded-For'),'192.0.2.123,198.51.100.10');
  });
}
test('missing edge IP removes caller-controlled IP headers', async () => {
  const r=runtime(new Response('ok'));
  await r.worker.fetch(new Request('https://infer.blog/',{headers:{'X-Forwarded-For':'192.0.2.123','X-Real-IP':'192.0.2.124'}}));
  assert.equal(r.calls[0].headers.has('X-Forwarded-For'),false);
  assert.equal(r.calls[0].headers.has('X-Real-IP'),false);
});
