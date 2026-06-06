# Apps Script 무지상품재고 파싱 수정

## 수정 위치
Google Sheets → 확장 프로그램 → Apps Script → `doGet` 함수 내부

`action==='getInventory'` 섹션에서 **무지상품재고 부분** 찾기

---

## 기존 코드 (삭제)

```javascript
    // ② 무지상품재고
    try{
      const sh=ss.getSheetByName(SHEET_NAMES.BLANK);
      if(sh&&sh.getLastRow()>1){
        sh.getRange(2,1,sh.getLastRow()-1,6).getValues()
          .filter(r=>r[0])
          .forEach(r=>{
            result.blank.push({
              garment:String(r[0]),color:String(r[1]),size:String(r[2]),
              stock:r[3]||0,safeStock:r[4]||30,status:String(r[5]||'')
            });
          });
      }
    }catch(er){}
```

---

## 새 코드 (붙여넣기)

```javascript
    // ② 무지상품재고 (2D 테이블: 색상×사이즈)
    try{
      const sh=ss.getSheetByName(SHEET_NAMES.BLANK);
      if(sh&&sh.getLastRow()>1){
        const data=sh.getRange(2,1,sh.getLastRow()-1,13).getValues(); // A~M 13열
        const SIZES=['110','120','130','140','150','160','170','M','L','XL','2XL','3XL']; // B~M
        
        let currentGarment='';
        data.forEach(r=>{
          const cellA=String(r[0]).trim();
          
          // 섹션 헤더 감지: [NY반팔티셔츠], [디즈니] 등
          if(cellA.startsWith('[')&&cellA.endsWith(']')){
            currentGarment=cellA.slice(1,-1); // 대괄호 제거
            return;
          }
          
          // 색상 행 처리: 컬러명 + 각 사이즈별 수량
          if(cellA&&currentGarment){
            const color=cellA;
            SIZES.forEach((size,idx)=>{
              let stock=r[idx+1]; // B~M 열: r[1]~r[12]
              
              // X, 공백, null → 0
              if(stock===''||stock==='X'||stock===null||stock===undefined){
                stock=0;
              }else{
                stock=Number(stock)||0;
              }
              
              result.blank.push({
                garment:currentGarment,
                color:color,
                size:size,
                stock:stock,
                safeStock:30,
                status:''
              });
            });
          }
        });
      }
    }catch(er){}
```

---

## 적용 순서

1. **Google Sheets 열기** → Apps Script 열기
2. **기존 코드 찾기**: Ctrl+F로 `// ② 무지상품재고` 검색
3. **기존 코드 삭제**: 7줄 전부 삭제
4. **새 코드 붙여넣기**: 위 새 코드 전체 복사해서 같은 위치에 붙여넣기
5. **Ctrl+S 저장**

---

## 주의사항

- 사이즈 순서: `110, 120, 130, 140, 150, 160, 170, M, L, XL, 2XL, 3XL` (B~M 열)
- 섹션 헤더: `[NY반팔티셔츠]` 형식 (반드시 대괄호)
- X 또는 빈 셀 = 0으로 변환
- currentGarment 초기화는 꼭 필요 (여러 섹션 처리 시)

---

## 테스트

저장 후 Python 서버에서:
```bash
curl http://localhost:8000/inventory
```

`blank` 배열에 새로운 구조로 데이터가 나오는지 확인!
