import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MonitoringConfig } from '../../config/domains/monitoring.config';
import { backupLastSuccessTimestampSeconds } from './metrics';
import { ObservabilityCollectorsService } from './observability-collectors.service';

/** The backup-status gauge (roadmap 9.4): one series per `<kind>.last-success` file, valued with its first line. */
describe('ObservabilityCollectorsService.refreshBackupStatus', () => {
  let dir: string;

  const service = (backupStatusDir?: string) =>
    new ObservabilityCollectorsService(
      {} as never,
      {} as never,
      {} as never,
      Object.assign(new MonitoringConfig(), { backupStatusDir }),
    );

  const series = async () => (await backupLastSuccessTimestampSeconds.get()).values.map((v) => ({ kind: v.labels.kind, value: v.value }));

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-status-'));
    backupLastSuccessTimestampSeconds.reset();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reads the UTC time on the first line of every <kind>.last-success file into the gauge', async () => {
    await fs.writeFile(path.join(dir, 'dump.last-success'), '2026-10-05T02:00:07Z\n/backups/dukaanai-20261005T020007Z.sql.gz\n');
    await fs.writeFile(path.join(dir, 'binlog.last-success'), '2026-10-05T17:35:00Z\nbinlog.000041\n');
    await fs.writeFile(path.join(dir, 'notes.txt'), 'ignored');
    await service(dir).refreshBackupStatus();
    expect(await series()).toEqual(
      expect.arrayContaining([
        { kind: 'dump', value: Date.parse('2026-10-05T02:00:07Z') / 1000 },
        { kind: 'binlog', value: Date.parse('2026-10-05T17:35:00Z') / 1000 },
      ]),
    );
    expect(await series()).toHaveLength(2);
  });

  it('drops the series of a kind whose file disappeared and skips a file without a readable time', async () => {
    await fs.writeFile(path.join(dir, 'documents.last-success'), '2026-10-05T03:00:00Z\n');
    await fs.writeFile(path.join(dir, 'offsite.last-success'), 'not a time\n');
    await service(dir).refreshBackupStatus();
    expect(await series()).toEqual([{ kind: 'documents', value: Date.parse('2026-10-05T03:00:00Z') / 1000 }]);

    await fs.rm(path.join(dir, 'documents.last-success'));
    await service(dir).refreshBackupStatus();
    expect(await series()).toEqual([]);
  });

  it('leaves the gauge alone when no directory is configured or it cannot be read', async () => {
    await fs.writeFile(path.join(dir, 'dump.last-success'), '2026-10-05T02:00:07Z\n');
    await service(dir).refreshBackupStatus();
    expect(await series()).toHaveLength(1);

    await service(undefined).refreshBackupStatus();
    expect(await series()).toHaveLength(1);
    await service(path.join(dir, 'missing')).refreshBackupStatus();
    expect(await series()).toHaveLength(1);
  });
});
