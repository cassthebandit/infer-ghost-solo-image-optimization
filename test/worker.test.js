import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../infer-image-optimizer.js', import.meta.url), 'utf8');
function runtime(response) {
  const calls = [];
  const context = vm.createContext({URL, Response, fetch: async request => {calls.push(request); return response;}, HTMLRewriter: class {
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
    assert.equal(r.calls.length,1); assert.equal(r.calls[0],request);
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
  test(method + ' public HTML gets non-enforcing baseline headers', async () => {
    const original = new Response(method === 'HEAD' ? null : '<html>hello</html>', {headers:{'content-type':'text/html', 'cache-control':'public, max-age=60'}});
    const r = runtime(original);
    const result = await r.worker.fetch(new Request('https://infer.blog/', {method}));
    assert.equal(result.headers.get('strict-transport-security'), 'max-age=31536000');
    assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(result.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(result.headers.get('cache-control'), 'public, max-age=60');
    assert.ok(result.headers.has('content-security-policy-report-only'));
    assert.equal(result.headers.has('content-security-policy'), false);
    assert.equal(await result.text(), method === 'HEAD' ? '' : '<html>hello</html>');
  });
}
