/**
 * Structured findings for `sdd check`.
 * Every finding carries what/where/fix per III.12: "Каждое сообщение содержит:
 * что не так, где именно, и что сделать. Сообщение без третьего пункта — дефект обвязки."
 */

export class Report {
  constructor() {
    this.findings = [];
  }

  blocking(rule, what, where, fix) {
    this.findings.push({ severity: 'blocking', rule, what, where, fix });
  }

  warn(rule, what, where, fix) {
    this.findings.push({ severity: 'warning', rule, what, where, fix });
  }

  get hasBlocking() {
    return this.findings.some((f) => f.severity === 'blocking');
  }

  print() {
    if (this.findings.length === 0) {
      console.log('OK — блокирующих нарушений и предупреждений нет.');
      return;
    }
    for (const f of this.findings) {
      const tag = f.severity === 'blocking' ? 'BLOCKING' : 'WARN';
      console.log(`[${tag}] ${f.rule}`);
      console.log(`  что:    ${f.what}`);
      console.log(`  где:    ${f.where}`);
      console.log(`  что делать: ${f.fix}`);
    }
    const blockingCount = this.findings.filter((f) => f.severity === 'blocking').length;
    const warnCount = this.findings.length - blockingCount;
    console.log(`\nИтог: ${blockingCount} блокирующих, ${warnCount} предупреждений.`);
  }
}
