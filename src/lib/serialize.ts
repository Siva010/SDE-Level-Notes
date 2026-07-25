import type { Level, LevelId, Subject, TopicBody } from './contract/types.js';

/**
 * The content store round-trips through JSON, so `Map` cannot live in it. The contract's
 * shape (§10) is what consumers see — these two functions are the only place the flat
 * storage form is allowed to exist.
 */

export interface StoredLevel {
  id: LevelId;
  topics: [string, TopicBody][];
  readTimeMin: number;
}

export interface StoredSubject extends Omit<Subject, 'levels'> {
  levels: StoredLevel[];
}

export function toStored(subject: Subject): StoredSubject {
  return {
    ...subject,
    levels: [...subject.levels.values()].map<StoredLevel>((level) => ({
      id: level.id,
      topics: [...level.topics.entries()],
      readTimeMin: level.readTimeMin,
    })),
  };
}

export function fromStored(stored: StoredSubject): Subject {
  const levels = new Map<LevelId, Level>();
  for (const level of stored.levels) {
    levels.set(level.id, {
      id: level.id,
      topics: new Map(level.topics),
      readTimeMin: level.readTimeMin,
    });
  }
  return { ...stored, levels };
}
