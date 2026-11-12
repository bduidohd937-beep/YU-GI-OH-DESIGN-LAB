// 사용자 지정 초동·연장·부담 분류는 실제로 불러온 YDK의 메인 덱만 참조한다.
// deck 객체는 {key, name, parsed} 구조이고 zones는 parsed 아래에 있다.
export function selectionFromImportedDeck(deck, record={}) {
  const present=new Set(deck?.parsed?.zones?.main||[]);
  const filter=key=>[...new Set(Array.isArray(record?.[key])?record[key]:[])]
    .filter(id=>present.has(id));
  return {
    starterIds:filter('starterIds'),
    extenderIds:filter('extenderIds'),
    riskIds:filter('riskIds')
  };
}
