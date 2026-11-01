/** Linear undo/redo over whole-file text snapshots. */
export class History {
	private undoStack: string[] = [];
	private redoStack: string[] = [];

	push(before: string): void {
		this.undoStack.push(before);
		this.redoStack.length = 0;
		if (this.undoStack.length > 200) this.undoStack.shift();
	}

	undo(current: string): string | null {
		const prev = this.undoStack.pop();
		if (prev === undefined) return null;
		this.redoStack.push(current);
		return prev;
	}

	redo(current: string): string | null {
		const next = this.redoStack.pop();
		if (next === undefined) return null;
		this.undoStack.push(current);
		return next;
	}

	/** Forget the latest snapshot without making it redoable. */
	discard(): string | null {
		return this.undoStack.pop() ?? null;
	}

	clear(): void {
		this.undoStack = [];
		this.redoStack = [];
	}
}
