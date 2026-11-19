/**
 * Clean seed: Wipes existing seed data and creates well-categorized books
 * with proper subject assignments. Uses recognizable, real books.
 *
 * Usage: npx tsx scripts/seed-clean.ts
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const USER_ID = "user_3C4BeJK23LJcypCJ5JI17gfzsLi";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Well-known books organized by subject
const CATALOG: Record<string, { title: string; author: string; year?: number }[]> = {
  "Fiction": [
    { title: "To Kill a Mockingbird", author: "Harper Lee", year: 1960 },
    { title: "The Great Gatsby", author: "F. Scott Fitzgerald", year: 1925 },
    { title: "One Hundred Years of Solitude", author: "Gabriel García Márquez", year: 1967 },
    { title: "Beloved", author: "Toni Morrison", year: 1987 },
    { title: "The Catcher in the Rye", author: "J.D. Salinger", year: 1951 },
    { title: "Invisible Man", author: "Ralph Ellison", year: 1952 },
    { title: "The Color Purple", author: "Alice Walker", year: 1982 },
    { title: "A Confederacy of Dunces", author: "John Kennedy Toole", year: 1980 },
    { title: "Catch-22", author: "Joseph Heller", year: 1961 },
    { title: "Slaughterhouse-Five", author: "Kurt Vonnegut", year: 1969 },
    { title: "The Road", author: "Cormac McCarthy", year: 2006 },
    { title: "Normal People", author: "Sally Rooney", year: 2018 },
    { title: "A Little Life", author: "Hanya Yanagihara", year: 2015 },
    { title: "The Goldfinch", author: "Donna Tartt", year: 2013 },
    { title: "The Secret History", author: "Donna Tartt", year: 1992 },
  ],
  "Science Fiction": [
    { title: "Dune", author: "Frank Herbert", year: 1965 },
    { title: "Neuromancer", author: "William Gibson", year: 1984 },
    { title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", year: 1969 },
    { title: "Foundation", author: "Isaac Asimov", year: 1951 },
    { title: "Ender's Game", author: "Orson Scott Card", year: 1985 },
    { title: "Snow Crash", author: "Neal Stephenson", year: 1992 },
    { title: "The Hitchhiker's Guide to the Galaxy", author: "Douglas Adams", year: 1979 },
    { title: "Brave New World", author: "Aldous Huxley", year: 1932 },
    { title: "1984", author: "George Orwell", year: 1949 },
    { title: "The Martian", author: "Andy Weir", year: 2011 },
    { title: "Project Hail Mary", author: "Andy Weir", year: 2021 },
    { title: "Exhalation", author: "Ted Chiang", year: 2019 },
    { title: "The Three-Body Problem", author: "Liu Cixin", year: 2008 },
    { title: "Kindred", author: "Octavia Butler", year: 1979 },
    { title: "Hyperion", author: "Dan Simmons", year: 1989 },
  ],
  "Fantasy": [
    { title: "The Hobbit", author: "J.R.R. Tolkien", year: 1937 },
    { title: "The Fellowship of the Ring", author: "J.R.R. Tolkien", year: 1954 },
    { title: "A Game of Thrones", author: "George R.R. Martin", year: 1996 },
    { title: "The Name of the Wind", author: "Patrick Rothfuss", year: 2007 },
    { title: "American Gods", author: "Neil Gaiman", year: 2001 },
    { title: "The Way of Kings", author: "Brandon Sanderson", year: 2010 },
    { title: "Harry Potter and the Philosopher's Stone", author: "J.K. Rowling", year: 1997 },
    { title: "The Earthsea Trilogy", author: "Ursula K. Le Guin", year: 1968 },
    { title: "The Fifth Season", author: "N.K. Jemisin", year: 2015 },
    { title: "Piranesi", author: "Susanna Clarke", year: 2020 },
    { title: "The Priory of the Orange Tree", author: "Samantha Shannon", year: 2019 },
    { title: "Circe", author: "Madeline Miller", year: 2018 },
  ],
  "Mystery": [
    { title: "The Girl with the Dragon Tattoo", author: "Stieg Larsson", year: 2005 },
    { title: "Gone Girl", author: "Gillian Flynn", year: 2012 },
    { title: "The Da Vinci Code", author: "Dan Brown", year: 2003 },
    { title: "In the Woods", author: "Tana French", year: 2007 },
    { title: "Big Little Lies", author: "Liane Moriarty", year: 2014 },
    { title: "The Silent Patient", author: "Alex Michaelides", year: 2019 },
    { title: "And Then There Were None", author: "Agatha Christie", year: 1939 },
    { title: "The Maltese Falcon", author: "Dashiell Hammett", year: 1930 },
    { title: "Rebecca", author: "Daphne du Maurier", year: 1938 },
    { title: "Sharp Objects", author: "Gillian Flynn", year: 2006 },
  ],
  "Horror": [
    { title: "The Shining", author: "Stephen King", year: 1977 },
    { title: "It", author: "Stephen King", year: 1986 },
    { title: "Frankenstein", author: "Mary Shelley", year: 1818 },
    { title: "Dracula", author: "Bram Stoker", year: 1897 },
    { title: "The Haunting of Hill House", author: "Shirley Jackson", year: 1959 },
    { title: "Mexican Gothic", author: "Silvia Moreno-Garcia", year: 2020 },
    { title: "House of Leaves", author: "Mark Z. Danielewski", year: 2000 },
    { title: "Bird Box", author: "Josh Malerman", year: 2014 },
  ],
  "Philosophy": [
    { title: "Meditations", author: "Marcus Aurelius", year: 180 },
    { title: "The Republic", author: "Plato", year: -380 },
    { title: "Beyond Good and Evil", author: "Friedrich Nietzsche", year: 1886 },
    { title: "Being and Time", author: "Martin Heidegger", year: 1927 },
    { title: "The Stranger", author: "Albert Camus", year: 1942 },
    { title: "Existentialism Is a Humanism", author: "Jean-Paul Sartre", year: 1946 },
    { title: "The Art of War", author: "Sun Tzu", year: -500 },
    { title: "Letters from a Stoic", author: "Seneca", year: 65 },
    { title: "The Nicomachean Ethics", author: "Aristotle", year: -340 },
    { title: "Zen and the Art of Motorcycle Maintenance", author: "Robert Pirsig", year: 1974 },
    { title: "Sophie's World", author: "Jostein Gaarder", year: 1991 },
    { title: "The Consolations of Philosophy", author: "Alain de Botton", year: 2000 },
  ],
  "Psychology": [
    { title: "Thinking, Fast and Slow", author: "Daniel Kahneman", year: 2011 },
    { title: "Man's Search for Meaning", author: "Viktor Frankl", year: 1946 },
    { title: "The Power of Habit", author: "Charles Duhigg", year: 2012 },
    { title: "Influence", author: "Robert Cialdini", year: 1984 },
    { title: "Flow", author: "Mihaly Csikszentmihalyi", year: 1990 },
    { title: "Stumbling on Happiness", author: "Daniel Gilbert", year: 2006 },
    { title: "The Body Keeps the Score", author: "Bessel van der Kolk", year: 2014 },
    { title: "Atomic Habits", author: "James Clear", year: 2018 },
    { title: "Predictably Irrational", author: "Dan Ariely", year: 2008 },
    { title: "Mindset", author: "Carol Dweck", year: 2006 },
    { title: "Quiet", author: "Susan Cain", year: 2012 },
    { title: "Grit", author: "Angela Duckworth", year: 2016 },
  ],
  "History": [
    { title: "Sapiens", author: "Yuval Noah Harari", year: 2011 },
    { title: "Guns, Germs, and Steel", author: "Jared Diamond", year: 1997 },
    { title: "A People's History of the United States", author: "Howard Zinn", year: 1980 },
    { title: "The Silk Roads", author: "Peter Frankopan", year: 2015 },
    { title: "SPQR", author: "Mary Beard", year: 2015 },
    { title: "The Rise and Fall of the Third Reich", author: "William Shirer", year: 1960 },
    { title: "Team of Rivals", author: "Doris Kearns Goodwin", year: 2005 },
    { title: "The History of the Peloponnesian War", author: "Thucydides", year: -400 },
    { title: "A Short History of Nearly Everything", author: "Bill Bryson", year: 2003 },
    { title: "Homo Deus", author: "Yuval Noah Harari", year: 2015 },
    { title: "The Splendid and the Vile", author: "Erik Larson", year: 2020 },
    { title: "Empire of Pain", author: "Patrick Radden Keefe", year: 2021 },
  ],
  "Economics": [
    { title: "Capital in the Twenty-First Century", author: "Thomas Piketty", year: 2013 },
    { title: "Freakonomics", author: "Steven Levitt", year: 2005 },
    { title: "The Wealth of Nations", author: "Adam Smith", year: 1776 },
    { title: "Thinking in Bets", author: "Annie Duke", year: 2018 },
    { title: "Nudge", author: "Richard Thaler", year: 2008 },
    { title: "The Black Swan", author: "Nassim Nicholas Taleb", year: 2007 },
    { title: "Antifragile", author: "Nassim Nicholas Taleb", year: 2012 },
    { title: "Fooled by Randomness", author: "Nassim Nicholas Taleb", year: 2001 },
    { title: "Poor Economics", author: "Abhijit Banerjee", year: 2011 },
    { title: "Misbehaving", author: "Richard Thaler", year: 2015 },
  ],
  "Science": [
    { title: "A Brief History of Time", author: "Stephen Hawking", year: 1988 },
    { title: "The Selfish Gene", author: "Richard Dawkins", year: 1976 },
    { title: "Cosmos", author: "Carl Sagan", year: 1980 },
    { title: "The Gene", author: "Siddhartha Mukherjee", year: 2016 },
    { title: "The Structure of Scientific Revolutions", author: "Thomas Kuhn", year: 1962 },
    { title: "Silent Spring", author: "Rachel Carson", year: 1962 },
    { title: "The Sixth Extinction", author: "Elizabeth Kolbert", year: 2014 },
    { title: "Why We Sleep", author: "Matthew Walker", year: 2017 },
    { title: "The Immortal Life of Henrietta Lacks", author: "Rebecca Skloot", year: 2010 },
    { title: "Entangled Life", author: "Merlin Sheldrake", year: 2020 },
  ],
  "Biography": [
    { title: "Steve Jobs", author: "Walter Isaacson", year: 2011 },
    { title: "Educated", author: "Tara Westover", year: 2018 },
    { title: "Becoming", author: "Michelle Obama", year: 2018 },
    { title: "The Autobiography of Malcolm X", author: "Malcolm X", year: 1965 },
    { title: "Long Walk to Freedom", author: "Nelson Mandela", year: 1994 },
    { title: "Einstein", author: "Walter Isaacson", year: 2007 },
    { title: "Born a Crime", author: "Trevor Noah", year: 2016 },
    { title: "When Breath Becomes Air", author: "Paul Kalanithi", year: 2016 },
    { title: "The Diary of a Young Girl", author: "Anne Frank", year: 1947 },
    { title: "Open", author: "Andre Agassi", year: 2009 },
  ],
  "Business": [
    { title: "Good to Great", author: "Jim Collins", year: 2001 },
    { title: "Zero to One", author: "Peter Thiel", year: 2014 },
    { title: "The Lean Startup", author: "Eric Ries", year: 2011 },
    { title: "The Innovator's Dilemma", author: "Clayton Christensen", year: 1997 },
    { title: "Shoe Dog", author: "Phil Knight", year: 2016 },
    { title: "Measure What Matters", author: "John Doerr", year: 2018 },
    { title: "The Hard Thing About Hard Things", author: "Ben Horowitz", year: 2014 },
    { title: "Start with Why", author: "Simon Sinek", year: 2009 },
    { title: "Principles", author: "Ray Dalio", year: 2017 },
    { title: "The Mom Test", author: "Rob Fitzpatrick", year: 2013 },
  ],
  "Technology": [
    { title: "The Innovators", author: "Walter Isaacson", year: 2014 },
    { title: "The Pragmatic Programmer", author: "David Thomas", year: 1999 },
    { title: "Clean Code", author: "Robert C. Martin", year: 2008 },
    { title: "Designing Data-Intensive Applications", author: "Martin Kleppmann", year: 2017 },
    { title: "The Mythical Man-Month", author: "Frederick Brooks", year: 1975 },
    { title: "Superintelligence", author: "Nick Bostrom", year: 2014 },
    { title: "Life 3.0", author: "Max Tegmark", year: 2017 },
    { title: "The Master Algorithm", author: "Pedro Domingos", year: 2015 },
    { title: "Algorithms to Live By", author: "Brian Christian", year: 2016 },
    { title: "The Code Breaker", author: "Walter Isaacson", year: 2021 },
  ],
  "Self Help": [
    { title: "The 7 Habits of Highly Effective People", author: "Stephen Covey", year: 1989 },
    { title: "How to Win Friends and Influence People", author: "Dale Carnegie", year: 1936 },
    { title: "The Subtle Art of Not Giving a F*ck", author: "Mark Manson", year: 2016 },
    { title: "Deep Work", author: "Cal Newport", year: 2016 },
    { title: "Essentialism", author: "Greg McKeown", year: 2014 },
    { title: "The Four Agreements", author: "Don Miguel Ruiz", year: 1997 },
    { title: "Can't Hurt Me", author: "David Goggins", year: 2018 },
    { title: "Range", author: "David Epstein", year: 2019 },
    { title: "Outliers", author: "Malcolm Gladwell", year: 2008 },
    { title: "The Tipping Point", author: "Malcolm Gladwell", year: 2000 },
  ],
  "Politics": [
    { title: "The Prince", author: "Niccolò Machiavelli", year: 1532 },
    { title: "On Tyranny", author: "Timothy Snyder", year: 2017 },
    { title: "Why Nations Fail", author: "Daron Acemoglu", year: 2012 },
    { title: "The Dictator's Handbook", author: "Bruce Bueno de Mesquita", year: 2011 },
    { title: "Manufacturing Consent", author: "Noam Chomsky", year: 1988 },
    { title: "The Road to Serfdom", author: "Friedrich Hayek", year: 1944 },
    { title: "Democracy in America", author: "Alexis de Tocqueville", year: 1835 },
    { title: "The Origins of Totalitarianism", author: "Hannah Arendt", year: 1951 },
  ],
};

// Some books belong to multiple subjects (bridge books)
const CROSS_LISTINGS: { title: string; subjects: string[] }[] = [
  { title: "1984", subjects: ["Fiction", "Science Fiction"] },
  { title: "Brave New World", subjects: ["Fiction", "Science Fiction"] },
  { title: "The Stranger", subjects: ["Fiction", "Philosophy"] },
  { title: "Sapiens", subjects: ["History", "Science"] },
  { title: "Homo Deus", subjects: ["History", "Science", "Technology"] },
  { title: "Thinking, Fast and Slow", subjects: ["Psychology", "Economics"] },
  { title: "The Black Swan", subjects: ["Economics", "Philosophy"] },
  { title: "Nudge", subjects: ["Economics", "Psychology"] },
  { title: "Algorithms to Live By", subjects: ["Technology", "Psychology"] },
  { title: "Outliers", subjects: ["Psychology", "Business"] },
  { title: "Freakonomics", subjects: ["Economics", "Science"] },
  { title: "The Selfish Gene", subjects: ["Science", "Philosophy"] },
  { title: "Zen and the Art of Motorcycle Maintenance", subjects: ["Philosophy", "Fiction"] },
  { title: "Kindred", subjects: ["Science Fiction", "Fiction"] },
  { title: "The Left Hand of Darkness", subjects: ["Science Fiction", "Fantasy"] },
  { title: "Circe", subjects: ["Fantasy", "Fiction"] },
  { title: "Educated", subjects: ["Biography", "Self Help"] },
  { title: "Born a Crime", subjects: ["Biography", "Politics"] },
  { title: "Zero to One", subjects: ["Business", "Technology"] },
  { title: "Principles", subjects: ["Business", "Self Help"] },
  { title: "Deep Work", subjects: ["Self Help", "Business"] },
  { title: "Steve Jobs", subjects: ["Biography", "Business", "Technology"] },
  { title: "The Innovators", subjects: ["Technology", "History"] },
  { title: "Superintelligence", subjects: ["Technology", "Philosophy"] },
  { title: "Why Nations Fail", subjects: ["Politics", "Economics", "History"] },
  { title: "Silent Spring", subjects: ["Science", "Politics"] },
];

const statuses = ["owns", "reading", "read", "wishlist"];

async function seed() {
  console.log("Cleaning old seed data...");

  // Delete old user edges, then books/authors/subjects will be clean
  await supabase.from("edges").delete().eq("source_id", USER_ID);
  await supabase.from("edges").delete().eq("edge_type", "wrote");
  await supabase.from("edges").delete().eq("edge_type", "belongs_to");
  await supabase.from("edges").delete().eq("edge_type", "linked_to");
  await supabase.from("authors").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("books").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("subjects").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  console.log("Creating subjects...");

  const subjectNames = Object.keys(CATALOG);
  const { data: subjectsInserted } = await supabase
    .from("subjects")
    .upsert(subjectNames.map((name) => ({ name })), { onConflict: "name" })
    .select("id, name");

  const { data: allSubjects } = await supabase.from("subjects").select("id, name");
  const subjectMap = new Map((allSubjects ?? []).map((s) => [s.name, s.id]));
  console.log(`Subjects: ${subjectMap.size}`);

  console.log("Creating books and authors...");

  const allBooks: { title: string; author: string; year?: number; subjects: string[] }[] = [];
  const crossMap = new Map(CROSS_LISTINGS.map((c) => [c.title, c.subjects]));

  for (const [subject, books] of Object.entries(CATALOG)) {
    for (const book of books) {
      const existing = allBooks.find((b) => b.title === book.title);
      if (existing) {
        if (!existing.subjects.includes(subject)) {
          existing.subjects.push(subject);
        }
      } else {
        const crossSubjects = crossMap.get(book.title);
        const subjects = crossSubjects
          ? [...new Set([subject, ...crossSubjects])]
          : [subject];
        allBooks.push({ ...book, subjects });
      }
    }
  }

  console.log(`Total unique books: ${allBooks.length}`);

  // Insert books
  const bookRows = allBooks.map((b) => ({
    title: b.title,
    author: b.author,
    published_year: b.year ?? null,
    cover_url: null,
  }));

  const insertedBooks: { id: string; title: string; author: string }[] = [];
  for (let i = 0; i < bookRows.length; i += 50) {
    const batch = bookRows.slice(i, i + 50);
    const { data } = await supabase.from("books").insert(batch).select("id, title, author");
    if (data) insertedBooks.push(...data);
  }
  console.log(`Inserted ${insertedBooks.length} books`);

  const bookIdByTitle = new Map(insertedBooks.map((b) => [b.title, b.id]));

  // Insert authors
  const uniqueAuthors = [...new Set(insertedBooks.map((b) => b.author))];
  for (let i = 0; i < uniqueAuthors.length; i += 50) {
    await supabase
      .from("authors")
      .upsert(uniqueAuthors.slice(i, i + 50).map((name) => ({ name })), {
        onConflict: "name",
        ignoreDuplicates: true,
      });
  }
  const { data: allAuthors } = await supabase.from("authors").select("id, name");
  const authorMap = new Map((allAuthors ?? []).map((a) => [a.name, a.id]));
  console.log(`Authors: ${authorMap.size}`);

  // Create wrote edges
  console.log("Creating wrote edges...");
  const wroteEdges = insertedBooks
    .filter((b) => authorMap.has(b.author))
    .map((b) => ({
      source_type: "author",
      source_id: authorMap.get(b.author)!,
      target_type: "book",
      target_id: b.id,
      edge_type: "wrote",
    }));

  for (let i = 0; i < wroteEdges.length; i += 50) {
    await supabase.from("edges").upsert(wroteEdges.slice(i, i + 50), {
      onConflict: "source_type,source_id,target_type,target_id,edge_type",
      ignoreDuplicates: true,
    });
  }
  console.log(`Wrote edges: ${wroteEdges.length}`);

  // Create belongs_to edges
  console.log("Creating belongs_to edges...");
  const belongsToEdges: {
    source_type: string; source_id: string;
    target_type: string; target_id: string;
    edge_type: string;
  }[] = [];

  for (const book of allBooks) {
    const bookId = bookIdByTitle.get(book.title);
    if (!bookId) continue;

    for (const subject of book.subjects) {
      const subjectId = subjectMap.get(subject);
      if (!subjectId) continue;
      belongsToEdges.push({
        source_type: "book",
        source_id: bookId,
        target_type: "subject",
        target_id: subjectId,
        edge_type: "belongs_to",
      });
    }
  }

  for (let i = 0; i < belongsToEdges.length; i += 50) {
    await supabase.from("edges").upsert(belongsToEdges.slice(i, i + 50), {
      onConflict: "source_type,source_id,target_type,target_id,edge_type",
      ignoreDuplicates: true,
    });
  }
  console.log(`belongs_to edges: ${belongsToEdges.length}`);

  // Create user→book edges with varied statuses
  console.log("Creating user→book edges...");
  const userEdges = insertedBooks.map((b) => ({
    source_type: "user",
    source_id: USER_ID,
    target_type: "book",
    target_id: b.id,
    edge_type: statuses[Math.floor(Math.random() * statuses.length)],
    metadata: JSON.stringify(
      Math.random() > 0.4 ? { rating: Math.ceil(Math.random() * 5) } : {}
    ),
  }));

  for (let i = 0; i < userEdges.length; i += 50) {
    await supabase.from("edges").upsert(userEdges.slice(i, i + 50), {
      onConflict: "source_type,source_id,target_type,target_id,edge_type",
      ignoreDuplicates: true,
    });
  }
  console.log(`User edges: ${userEdges.length}`);

  console.log("\nDone! Clean seed complete.");
  console.log(`${insertedBooks.length} books across ${subjectMap.size} subjects`);
  console.log(`${belongsToEdges.length} belongs_to edges (including ${CROSS_LISTINGS.length} bridge books)`);
}

seed().catch(console.error);
