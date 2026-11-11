// V0.7.1 — ZIP 내부 선택 설치와 명시적 긴급 패치 계층을 구분합니다.
// 파일명에서 확인 가능한 버전만 사용하며 추측으로 버전 충돌을 덮지 않습니다.
export function isOptionalInstallPath(path = '') {
  const parts = String(path).replace(/\\/g, '/').normalize('NFKC').split('/');
  return parts.some((part) => /선택[\s_-]*설치|optional[\s_-]*install/i.test(part));
}

export function versionFromFilename(origin = '') {
  // 파일명/ZIP명에 나타난 V0.9.2, V1.6.1 같은 버전만 인식합니다.
  const matches = [...String(origin).matchAll(/(?:^|[^A-Za-z0-9])v(\d+)\.(\d+)(?:\.(\d+))?(?![\d.])/gi)];
  const found = matches[0];
  if (!found) return null;
  return [Number(found[1]), Number(found[2]), Number(found[3] || 0)];
}

export function compareVersions(left, right) {
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

export function resolveLuaRevision(entries = []) {
  if (!entries.length) return {script:null, patchApplied:false, conflict:false, label:null};
  const uniqueTexts = new Set(entries.map((entry) => entry.text));
  if (uniqueTexts.size <= 1) return {script:entries[entries.length-1],patchApplied:false,conflict:false,label:null};
  const variants = entries.map((script) => ({
    script,
    version: versionFromFilename(script.origin),
    declaredPatch: /(?:긴급[\s_-]*패치|핫픽스|hotfix|patch)/i.test(script.origin || '')
  }));
  if (variants.every((entry) => entry.version)) {
    const sorted = [...variants].sort((a,b) => compareVersions(a.version,b.version));
    const highest = sorted[sorted.length-1];
    const runners = sorted.slice(0,-1);
    const uniqueMax = runners.every((item) => compareVersions(item.version,highest.version) < 0);
    if (uniqueMax && highest.declaredPatch) {
      return {
        script:highest.script,
        patchApplied:true,
        conflict:false,
        label:'V' + highest.version.join('.'),
        previousVersions:[...new Set(runners.map((item) => 'V'+item.version.join('.')))]
      };
    }
  }
  // 파일명만으로 명시적인 순차 패치를 확인할 수 없으면 안전하게 충돌로 표시.
  return {script:entries[entries.length-1],patchApplied:false,conflict:true,label:null};
}
