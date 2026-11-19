export const FICTION_SUBJECTS = new Set([
  "Fiction",
  "Fantasy",
  "Science Fiction",
  "Horror",
  "Thriller",
  "Romance",
  "Adventure",
  "Young Adult",
  "Classic Literature",
  "Mystery",
]);

export function isFiction(subjectName: string): boolean {
  return FICTION_SUBJECTS.has(subjectName);
}
