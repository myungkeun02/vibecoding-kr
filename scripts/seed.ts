import { apps } from '../src/lib/apps';
import { syncTools } from '../src/lib/db';
syncTools(apps);
console.log(`카탈로그 ${apps.length}개 동기화 완료. 사용자 데이터 보존.`);
