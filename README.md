# pyminer

PyCon 행사형 인터랙티브 게임 MVP.

## 현재 상태
- [x] 기획서 v1 작성
- [x] MVP 코드 스캐폴딩
- [x] 코어 루프 구현
- [x] 명령 큐(tnt/boost/slow/big/shield)
- [x] 스폰서 스킬 3종(Cloud/Security/AI)

## 실행
### macOS / Linux
```bash
chmod +x run.sh
./run.sh
```

### 수동 실행
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python src/main.py
```

## 조작키
- 이동: `A/D` 또는 `←/→`
- 명령 입력:
  - `1`: tnt
  - `2`: boost
  - `3`: slow
  - `4`: big
  - `5`: shield
- `R`: 라운드 재시작
- `ESC`: 종료

## 설정
`default.config.json` 기반으로 첫 실행 시 `config.json` 자동 생성.
원하는 밸런스는 `config.json`에서 조정.
