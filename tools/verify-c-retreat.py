# Isolated validation of the unchanged pinned Angband C strategic-retreat block.
# Angband/Borg code is GPL-2.0; upstream credit remains with its authors.
# Helpers model straight corridors, supplied visibility/happy cells, no vault.
# This is a branch/numeric oracle, not a full native C-controller replay.
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import tempfile
if len(sys.argv) != 2:
    raise SystemExit("Usage: python3 tools/verify-c-retreat.py <Angband e473720e root>")
source_path = Path(sys.argv[1]) / "src/borg/borg-caution.c"
if hashlib.sha256(source_path.read_bytes()).hexdigest() != "58eeeeab1e9af039f4cf0bd9a03b457bba346e1047a5ebc631971a65b8a68317":
    raise SystemExit("Wrong C reference: expected borg-caution.c at e473720e")
source = source_path.read_text()
start=source.index('    /*\n     * Strategic retreat\n')
end=source.index('    /*** Escape if possible ***/',start)
body=source[start:end]
header=r'''
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
enum {BI_ISCONFUSED,BI_CURHP,BI_MAXHP,BI_IFIRE,BI_CLEVEL,BI_SPEED};
#define FEAT_LAVA 99
#define I2D(x) (x)
#define borg_note(x) ((void)0)
struct loc { int x,y; };
static struct loc loc(int x,int y) { return (struct loc){x,y}; }
typedef struct { int feat,kill; bool trap,glyph; } borg_grid;
typedef struct { int r_idx,when,speed; struct loc pos; } borg_kill;
static borg_grid borg_grids[66][198];
static borg_kill borg_kills[20];
static int borg_kills_nxt=1,borg_view_n,borg_view_x[100],borg_view_y[100],command;
static int ddx[]={0,-1,0,1,-1,0,1,-1,0,1},ddy[]={0,1,1,1,0,0,0,-1,-1,-1};
static struct {struct loc c; int avoidance,no_retreat,morgoth_position,antibounce_count;
 int trait[6]; struct {int antisummon;} time;
 struct {int ignoring,type; struct loc g;} goal;} borg;
static struct {int num,x[100],y[100];} track_step;
static int landing;
static void *cave;
static int borg_timer(int stamp) { return 1000-stamp; }
static bool square_isvault(void *c,struct loc p) { return false; }
static bool borg_cave_floor_grid(borg_grid *a) {return a->feat==1;}
static bool borg_cave_floor_bold(int y,int x) {return borg_cave_floor_grid(&borg_grids[y][x]);}
static bool borg_happy_grid_bold(int y,int x) {return y==10&&(x==9||x==11);}
static int borg_goto_dir(int y1,int x1,int y2,int x2) {
 int dx=(x2>x1)-(x2<x1),dy=(y2>y1)-(y2<y1);
 for(int d=1;d<=9;d++)if(ddx[d]==dx&&ddy[d]==dy)return d;
 return 5;
}
static int borg_danger(int y,int x,int a,bool b,bool c) { return x==10?8:landing; }
static int distance(struct loc a,struct loc b) {int dx=abs(a.x-b.x),dy=abs(a.y-b.y);return dx>dy?dx+dy/2:dy+dx/2;}
static void borg_keypress(int d) {command=d;}
static bool retreat(int pos_danger,bool nasty,bool borg_surround) {int j;
'''
footer=r'''
return false;}
int main(int argc,char **argv) {
 borg.c=loc(10,10);borg.avoidance=10;
 borg.trait[BI_CURHP]=atoi(argv[1]);borg.trait[BI_MAXHP]=16;
 borg.trait[BI_CLEVEL]=2;borg.trait[BI_SPEED]=110;
 landing=atoi(argv[2]);borg.no_retreat=atoi(argv[3]);
 borg.trait[BI_ISCONFUSED]=atoi(argv[4]);
 borg_grids[10][9].feat=borg_grids[10][10].feat=borg_grids[10][11].feat=1;
 borg_view_n=3;borg_view_x[0]=10;borg_view_y[0]=10;
 borg_view_x[1]=11;borg_view_y[1]=10;borg_view_x[2]=9;borg_view_y[2]=10;
 if(argc>5){borg_view_n=2;borg_kills_nxt=2;borg_kills[1]=(borg_kill){.r_idx=47,.when=1000,.speed=120,.pos={12,10}};}
 bool result=retreat(8,false,false);
 printf("{\"retreat\":%s,\"direction\":%d}\n",result?"true":"false",command);
}
'''
with tempfile.TemporaryDirectory(prefix="borg-c-retreat-") as tmp:
    p = Path(tmp)
    (p / "retreat.c").write_text(header + body + footer)
    subprocess.run(["cc", "-O0", str(p / "retreat.c"), "-o", str(p / "retreat")], check=True)
    cases = [
        ("safe, west wins equal-distance tie", (10, 0, 0, 0), True, 4),
        ("strict HP9 threshold rejects danger3", (9, 3, 0, 0), False, 0),
        ("HP9 accepts danger2", (9, 2, 0, 0), True, 4),
        ("no-retreat guard", (10, 0, 1, 0), False, 0),
        ("confusion guard", (10, 0, 0, 1), False, 0),
        ("inner fast-monster loop does not reject", (10, 0, 0, 0, 1), True, 6),
    ]
    for name, args, expected, direction in cases:
        actual = json.loads(subprocess.check_output([str(p / "retreat"), *map(str, args)]))
        assert actual == {"retreat": expected, "direction": direction}, (name, actual)
        print(json.dumps({"case": name, **actual}))
    print("C block SHA256 " + hashlib.sha256(body.encode()).hexdigest())
