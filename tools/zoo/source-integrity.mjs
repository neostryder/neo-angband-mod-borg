// Source-content changes are distinct from pnpm's approved SDK executable bits.
import { execFileSync } from 'node:child_process';
const git=(dir,...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8'}).trimEnd();
export function sourceIntegrity(dir,{engine=false}={}) {
 const status=git(dir,'status','--porcelain','--untracked-files=all');
 const stats=git(dir,'diff','HEAD','--numstat').split('\n').filter(Boolean);
 if(stats.some(row=>!/^0\t0\t/.test(row)))throw Error('Uncommitted source contents: '+dir);
 const modes=git(dir,'diff','HEAD','--summary').split('\n').map(s=>s.trim()).filter(Boolean);
 if(modes.some(row=>!engine||!/^mode change 100644 => 100755 packages\/mod-sdk\/bin\/neo-angband-mod-(build|check)\.mjs$/.test(row)))throw Error('Unapproved source mode/type change: '+dir);
 if(status.split('\n').filter(Boolean).some(row=>!engine||!/^ M packages\/mod-sdk\/bin\/neo-angband-mod-(build|check)\.mjs$/.test(row)))throw Error('Dirty or untracked source files: '+dir);
 return {verifiedClean:true,approvedModeChanges:modes,commit:git(dir,'rev-parse','HEAD')};
}
export function recordedSourcesClean(build) {
 return build.borg?.dirty===false && (build.engine?.dirty===false || (build.engine.sourceIntegrity?.verifiedClean===true && build.engine.sourceIntegrity.commit===build.engine.commit && Array.isArray(build.engine.sourceIntegrity.approvedModeChanges) && build.engine.sourceIntegrity.approvedModeChanges.length>0 && build.engine.sourceIntegrity.approvedModeChanges.every(row=>/^mode change 100644 => 100755 packages\/mod-sdk\/bin\/neo-angband-mod-(build|check)\.mjs$/.test(row))));
}
