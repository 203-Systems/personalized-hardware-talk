#!/usr/bin/env python3
"""Exercise anonymous storage and edit authorization against a LOCAL service only."""
import json
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

base = sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8787/api/feedback'
assert urllib.parse.urlparse(base).hostname in {'localhost','127.0.0.1'}, 'This test only writes to a local database'
key = secrets.token_hex(32)
version = 'qa-' + uuid.uuid4().hex[:12]
def call(method='GET', body=None, query='', edit_key=key, origin='http://localhost:8000'):
    request=urllib.request.Request(base+query,method=method,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json','X-Edit-Key':edit_key,'Origin':origin})
    try:
        with urllib.request.urlopen(request) as response: return response.status,json.load(response),response.headers
    except urllib.error.HTTPError as error: return error.code,json.load(error),error.headers
id=str(uuid.uuid4())
root={'id':id,'version':version,'slide':1,'kind':'request','content':'LOCAL QA: improve slide title','author':'QA','point':{'x':0,'y':1}}
assert call('POST',root)[0]==201
assert call('POST',root)[0]==200, 'Network retry must not duplicate a submission'
code,data,headers=call(query=f'?version={version}&slide=1')
assert code==200 and len(data['items'])==1 and data['items'][0]['x']==0
assert 'edit_hash' not in json.dumps(data) and key not in json.dumps(data), 'Management credentials leaked'
assert headers['Access-Control-Allow-Origin']=='http://localhost:8000'
assert call(query=f'?version={version}&slide=2')[1]['items']==[]
assert call(query='?version=other-version&slide=1')[1]['items']==[]
assert call('PATCH',{'id':id,'status':'done'},edit_key=secrets.token_hex(32))[0]==403
assert call('DELETE',{'id':id},edit_key=secrets.token_hex(32))[0]==403
assert call('PATCH',{'id':id,'status':'planned'})[0]==200
reply={**root,'id':str(uuid.uuid4()),'parentId':id,'content':'LOCAL QA reply','point':None}
assert call('POST',reply)[0]==201
assert len(call(query=f'?version={version}&slide=1')[1]['replies'])==1
assert call('POST',{**root,'id':str(uuid.uuid4()),'point':{'x':2,'y':0}})[0]==400
assert call('POST',{**root,'id':str(uuid.uuid4())},origin='https://untrusted.example')[0]==403
assert call('DELETE',{'id':id})[0]==200
assert call(query=f'?version={version}&slide=1')[1]['items'][0]['content']=='（提交者已撤回）'
assert len(call(query=f'?version={version}&slide=1')[1]['replies'])==1, 'Withdrawal removed another discussion contribution'
rate_key=secrets.token_hex(32)
for number in range(31):
    code,_,_=call('POST',{**root,'id':str(uuid.uuid4()),'content':f'LOCAL rate QA {number}'},edit_key=rate_key)
    assert code==(201 if number<30 else 429), f'Rate limit wrong at {number}: {code}'
print('PASS: persistence, idempotency, version/page isolation, coordinate validation, CORS, reply retention, edit authorization, withdrawal and 30/hour rate limit.')
