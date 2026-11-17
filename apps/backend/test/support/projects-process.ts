import { openFactory } from "../../src/index.ts";
import { ControlledGit } from "./controlled-git.ts";
import { ControlledT3 } from "./controlled-t3.ts";
const t3 = new ControlledT3();
t3.available = false;
const factory = await openFactory({
  databasePath: process.argv[2]!,
  t3,
  git: new ControlledGit(),
});
try {
  process.stdout.write(JSON.stringify(await factory.listProjects()));
} finally {
  await factory.close();
}
