#!/usr/bin/env bash
# CI integration job 전용 mvn 대리 실행기 — PATH 맨 앞에 `mvn` 이름으로 놓인다.
#
# 왜: MAVEN_ARGS 의 HTTP 재시도(5회·3초 간격)는 한 요청 안에서 15초 남짓만 버틴다.
#   maven.egovframe.go.kr 의 502 가 그보다 길게 이어지면 테스트가 띄운 mvn 이 그대로 실패했다(v0.42·v0.45 CI).
#   그래서 명령 전체를 원격 저장소 일시 장애(5xx·연결 끊김)로 실패했을 때만 30초·60초 뒤 다시 실행한다.
#   두 번째부터는 -U 를 붙여 로컬 저장소에 기록된 실패(.lastUpdated)를 무시하고 다시 받는다.
#   v1.6: Maven 3.9 의 새 형식 "transfer failed for <url>, status: 503 Service Unavailable" 도 일시 장애로 본다(2026-10-25 Jenkins 실측 — 예전 문구만 보고 놓쳤다).
#   컴파일 오류 같은 일반 실패는 재시도하지 않는다.
#
# stdout·stderr 는 마지막 시도의 것만 그대로(분리해서) 내보낸다 — 테스트가 stdout 을 파싱하는 경우가 있다.
set -u
real="${REAL_MVN:?REAL_MVN 에 실제 mvn 경로가 있어야 합니다}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
transient='HTTP Status: 5[0-9][0-9]|status code:? 5[0-9][0-9]|status: 5[0-9][0-9]|Connection reset|Read timed out|Connect timed out|Remote host terminated the handshake'
attempt=1
max=3
extra=()
while :; do
  "$real" ${extra[@]+"${extra[@]}"} "$@" >"$work/out" 2>"$work/err"
  status=$?
  if [ "$status" -eq 0 ] || [ "$attempt" -ge "$max" ] || ! grep -Eq "$transient" "$work/out" "$work/err"; then
    break
  fi
  wait_s=$((attempt * 30))
  echo "mvn-retry: 원격 저장소 일시 장애로 실패(종료 코드 $status) — ${wait_s}초 뒤 다시 실행($((attempt + 1))/$max, -U)" >&2
  grep -Eh "$transient" "$work/out" "$work/err" | head -3 >&2
  sleep "$wait_s"
  attempt=$((attempt + 1))
  extra=(-U)
done
cat "$work/out"
cat "$work/err" >&2
exit "$status"
