import subprocess, sys
out, files = sys.argv[1], sys.argv[2:]
w, h = 640, 360
args, fl = [], ''
for k, f in enumerate(files):
    args += ['-i', f]; fl += f'[{k}]scale={w}:{h}[v{k}];'
lay = '|'.join(f'{(k%2)*w}_{(k//2)*h}' for k in range(len(files)))
fl += ''.join(f'[v{k}]' for k in range(len(files))) + f'xstack=inputs={len(files)}:layout={lay}:fill=black'
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *args, '-filter_complex', fl, out], check=True)
