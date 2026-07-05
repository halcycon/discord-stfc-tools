/** In-game Ops level → grade (G3–G7). */
export function opsLevelToGrade(opsLevel: number): number | null {
	if (opsLevel <= 0) return null;
	if (opsLevel <= 39) return 3;
	if (opsLevel <= 50) return 4;
	if (opsLevel <= 60) return 5;
	if (opsLevel <= 70) return 6;
	if (opsLevel <= 80) return 7;
	return null;
}

export function formatGrade(opsLevel: number): string {
	const grade = opsLevelToGrade(opsLevel);
	return grade ? `G${grade}` : `Ops ${opsLevel}`;
}
