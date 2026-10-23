# 单文件离线版生成：把站点文件按 index.html 原始顺序内联成一个 HTML。
# 双击即开、断网可用、可直接转发。
import os

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(SRC, 'promo', '海证_单文件离线版.html')

html = open(os.path.join(SRC, 'index.html'), encoding='utf-8').read()
css = open(os.path.join(SRC, 'styles.css'), encoding='utf-8').read()

JS = ['data.js', 'admin.js', 'boundary.js', 'land.js', 'prices.js',
      'currents.js', 'model.js', 'atmos_f.js', 'manifest-data.js',
      'field.js', 'flowmap.js', 'app.js']

# 1) CSS 内联（防御：若含 </style 则转义）
css = css.replace('</style', '<\\/style')
html = html.replace('<link rel="stylesheet" href="styles.css">',
                    '<style>\n' + css + '\n</style>')

# 2) 逐个替换 <script src="x.js"></script>
total_js = 0
for name in JS:
    body = open(os.path.join(SRC, name), encoding='utf-8').read()
    total_js += len(body.encode('utf-8'))
    body = body.replace('</script', '<\\/script')
    tag = '<script src="%s"></script>' % name
    assert tag in html, '未找到标签: ' + tag
    html = html.replace(tag, '<script>\n/* ==== %s ==== */\n%s\n</script>' % (name, body))

# 3) PWA 注册块在单文件里无意义（file:// 不支持 SW），移除
sw_block = ('<script>\n'
            '/* PWA：注册 Service Worker，安装后离线可用 */\n'
            "if ('serviceWorker' in navigator) {\n"
            "  navigator.serviceWorker.register('sw.js').catch(function () {});\n"
            '}\n'
            '</script>')
assert sw_block in html, '未找到 SW 注册块'
html = html.replace(sw_block, '')
# manifest / icon 外链也去掉（file:// 下无效）
html = html.replace('<link rel="manifest" href="manifest.json">\n', '')
html = html.replace('<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">\n', '')

# 4) 标题与说明标注
html = html.replace('<title>海证 OceanProof',
                    '<title>海证 OceanProof · 单文件离线版')

banner = ('<!-- 单文件离线版：全部代码与数据已内联，无外部请求。'
          '双击即可在浏览器打开，断网可用，可直接转发。 -->\n')
html = html.replace('<!doctype html>', '<!doctype html>\n' + banner, 1)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'w', encoding='utf-8').write(html)

print('输出:', OUT)
print('内联 JS 合计: %.0f KB' % (total_js / 1024))
print('单文件大小: %.0f KB' % (os.path.getsize(OUT) / 1024))
print('残留 script src:', html.count('<script src='))
print('残留 stylesheet link:', html.count('rel="stylesheet"'))
print('内联 style 块:', html.count('<style>'))
print('内联 script 块:', html.count('<script>\n/* ===='))
