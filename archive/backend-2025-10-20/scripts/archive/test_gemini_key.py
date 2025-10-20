#!/usr/bin/env python3
import os
import sys

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

try:
    import google.generativeai as genai
except Exception as e:
    print('ERROR: failed to import google.generativeai:', str(e)[:200])
    sys.exit(1)

key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY')
model_name = os.getenv('MODEL_NAME', 'gemini-2.5-pro')
print('key_present', bool(key))
print('model', model_name)
if not key:
    print('ERROR: missing GEMINI_API_KEY/GOOGLE_API_KEY')
    sys.exit(2)

try:
    os.environ.setdefault('GOOGLE_API_KEY', key)
    genai.configure(api_key=key)
    model = genai.GenerativeModel(model_name)
    resp = model.generate_content(['Return OK'])
    text = (resp.text or '').strip()
    print('RESULT:', text or 'EMPTY')
    sys.exit(0)
except Exception as e:
    print('ERROR:', str(e)[:500])
    sys.exit(1)

#!/usr/bin/env python3
import os
import sys

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

try:
    import google.generativeai as genai
except Exception as e:
    print('ERROR: failed to import google.generativeai:', str(e)[:200])
    sys.exit(1)

key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY')
model_name = os.getenv('MODEL_NAME', 'gemini-2.5-pro')
print('key_present', bool(key))
print('model', model_name)
if not key:
    print('ERROR: missing GEMINI_API_KEY/GOOGLE_API_KEY')
    sys.exit(2)

try:
    os.environ.setdefault('GOOGLE_API_KEY', key)
    genai.configure(api_key=key)
    model = genai.GenerativeModel(model_name)
    resp = model.generate_content(['Return OK'])
    text = (resp.text or '').strip()
    print('RESULT:', text or 'EMPTY')
    sys.exit(0)
except Exception as e:
    print('ERROR:', str(e)[:500])
    sys.exit(1)


