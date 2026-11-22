const fs = require('node:fs');
const path = require('node:path');

// Packed metadata: immediate bytes, minimum stack depth, resulting stack change.
const meta = new Int16Array(256); meta.fill(-1);
function def(op, imm, need, delta) { meta[op] = imm | (need << 3) | ((delta + 2) << 6); }
def(0,0,0,0); def(1,1,0,1); def(2,4,0,1); def(3,0,1,-1);
def(4,0,1,1); def(5,0,2,0); def(6,0,2,1); def(7,0,3,0);
for (let i=0x10; i<=0x1e; i++) def(i,0,i===0x17 || i===0x1b ? 1 : 2,i===0x17 || i===0x1b ? 0 : -1);
for (let i=0x20; i<=0x22; i++) def(i,0,2,-1);
def(0x30,2,0,0); def(0x31,2,1,-1); def(0x32,2,1,-1);
def(0x33,2,0,0); def(0x34,0,0,0); def(0x40,0,1,0); def(0x41,0,2,-2);
def(0x50,0,1,-1); def(0x51,0,1,-1); def(0x52,0,0,1); def(0x53,0,1,-1);

function run(p, input) {
  const s = new Int32Array(256), mem = new Int32Array(256), calls = new Int32Array(64);
  const out = Buffer.allocUnsafe(65536);
  let sp = 0, cp = 0, pc = 0, ip = 0, optr = 0, steps = 0, code = 0;
  while (true) {
    if (steps >= 1000000) { code = 10; break; }
    if (pc < 0 || pc >= p.length) { code = 9; break; }
    const op = p[pc], m = meta[op];
    if (m < 0) { code = 5; break; }
    const len = m & 7;
    if (pc + 1 + len > p.length) { code = 9; break; }
    steps++;
    const need = (m >> 3) & 7, delta = (m >> 6) - 2;
    if (sp < need) { code = 2; break; }
    if (sp + delta > 256) { code = 3; break; }
    let a, b, n;
    pc++;
    switch (op) {
      case 0: return [out.subarray(0,optr), 0];
      case 1: s[sp++] = (p[pc++] << 24) >> 24; break;
      case 2: s[sp++] = p.readInt32LE(pc); pc += 4; break;
      case 3: sp--; break;
      case 4: s[sp] = s[sp-1]; sp++; break;
      case 5: a=s[sp-1]; s[sp-1]=s[sp-2]; s[sp-2]=a; break;
      case 6: s[sp]=s[sp-2]; sp++; break;
      case 7: a=s[sp-3]; s[sp-3]=s[sp-2]; s[sp-2]=s[sp-1]; s[sp-1]=a; break;
      case 0x10: b=s[--sp]; s[sp-1]+=b; break;
      case 0x11: b=s[--sp]; s[sp-1]-=b; break;
      case 0x12: b=s[--sp]; s[sp-1]=Math.imul(s[sp-1],b); break;
      case 0x13: case 0x14: case 0x15: case 0x16:
        b=s[--sp]; a=s[sp-1]; if (b===0) { code=4; break; }
        if (op===0x13) s[sp-1]=(a/b)|0;
        else if (op===0x14) s[sp-1]=a%b;
        else if (op===0x15) s[sp-1]=((a>>>0)/(b>>>0))|0;
        else s[sp-1]=(a>>>0)%(b>>>0);
        break;
      case 0x17: s[sp-1]=-s[sp-1]; break;
      case 0x18: b=s[--sp]; s[sp-1]&=b; break;
      case 0x19: b=s[--sp]; s[sp-1]|=b; break;
      case 0x1a: b=s[--sp]; s[sp-1]^=b; break;
      case 0x1b: s[sp-1]=~s[sp-1]; break;
      case 0x1c: b=s[--sp]; s[sp-1]<<=b; break;
      case 0x1d: b=s[--sp]; s[sp-1]>>=b; break;
      case 0x1e: b=s[--sp]; s[sp-1]>>>=b; break;
      case 0x20: b=s[--sp]; s[sp-1]=+(s[sp-1]===b); break;
      case 0x21: b=s[--sp]; s[sp-1]=+(s[sp-1]<b); break;
      case 0x22: b=s[--sp]; s[sp-1]=+((s[sp-1]>>>0)<(b>>>0)); break;
      case 0x30: case 0x31: case 0x32:
        n=(p[pc] | (p[pc+1]<<8)); n=(n<<16)>>16; pc+=2;
        if (op===0x30 || (op===0x31 ? s[--sp]===0 : s[--sp]!==0)) pc+=n;
        break;
      case 0x33:
        n=p[pc] | (p[pc+1]<<8); pc+=2;
        if (cp===64) { code=7; break; }
        calls[cp++]=pc; pc=n; break;
      case 0x34: if (!cp) { code=8; break; } pc=calls[--cp]; break;
      case 0x40: a=s[sp-1]; if (a<0 || a>255) { code=6; break; } s[sp-1]=mem[a]; break;
      case 0x41: a=s[--sp]; if (a<0 || a>255) { code=6; break; } mem[a]=s[--sp]; break;
      case 0x50:
        a=String(s[--sp]); n=a.length;
        if (optr+n>65536) { code=11; break; }
        for (let i=0; i<n; i++) out[optr++]=a.charCodeAt(i);
        break;
      case 0x51:
        if (optr===65536) { code=11; break; }
        out[optr++]=s[--sp]&255; break;
      case 0x52: s[sp++]=ip<input.length ? input[ip++] : -1; break;
      case 0x53: return [out.subarray(0,optr), s[--sp]&255];
    }
    if (code) break;
  }
  return [out.subarray(0,optr), code];
}

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of fs.readdirSync(inputDir).sort()) {
  const dir = path.join(inputDir,id), dest = path.join(outputDir,id);
  const [stdout, exit] = run(fs.readFileSync(path.join(dir,'program.bin')), fs.readFileSync(path.join(dir,'input.bin')));
  fs.mkdirSync(dest,{recursive:true});
  fs.writeFileSync(path.join(dest,'stdout.bin'),stdout);
  fs.writeFileSync(path.join(dest,'exit.txt'),String(exit)+'\n');
}
