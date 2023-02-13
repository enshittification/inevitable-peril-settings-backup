import {message, warn, fail, danger} from "danger";

function findCommitPods(entry: any): string[] {
    if (typeof entry === 'string') {
        const match = entry.match(/(.*)\(from .*, commit `.*`/);
        return (match != null) ? [match[1]] : [];
    } else {
        const key: string = Object.keys(entry)[0];
        const keyMatch: string[] = findCommitPods(key);
        const depsMatches: string[] = entry[key].flatMap(findCommitPods);
        return keyMatch.concat(depsMatches);
    }
}

export default async () => {

    const pr = danger.github.pr;
    const githubLabels = danger.github.issue.labels;

    // Core Data Model Safety Checks
    const targetReleaseBranch = pr.base.ref.startsWith("release/");
    const modifiedFiles = danger.git.modified_files;
    const changedFiles = modifiedFiles.concat(danger.git.deleted_files).concat(danger.git.created_files);
    const hasModifiedModel = changedFiles.some(path => path.includes(".xcdatamodeld"));
    if (targetReleaseBranch && hasModifiedModel) {
        warn("Core Data: Do not edit an existing Core Data model in a release branch unless it hasn't been released to testers yet. Instead create a new model version and merge back to develop soon.");
    }

    // Podfile should not reference commit hashes.
    //
    // Verify by parsing Podfile.lock because it uses a standard format, unlike Podfile which might be written in different ways.
    //
    // Example of relevant Podfile.lock portion:
    //
    // DEPENDENCIES:
    //     - Kanvas(from `https://github.com/tumblr/Kanvas-iOS.git`, branch `main`)
    //     - WordPress - Editor - iOS(~> 1.19.8)
    //     - WordPressUI(from `https://github.com/wordpress-mobile/WordPressUI-iOS`, commit `5ab5fd3dc8f50a27181cf14e101abe3599398
// cad`)
    const podfileLockContents = await danger.github.utils.fileContents("Podfile.lock");
    const podfileLockYAML = require("js-yaml").safeLoad(podfileLockContents);

    // check if any pods are referenced from a commit hash
    const allPods = podfileLockYAML && podfileLockYAML["DEPENDENCIES"]
    const podsReferencedByCommit = allPods?.flatMap(findCommitPods)
    if (podsReferencedByCommit?.length > 0) {
        fail(`Podfile: reference to a commit hash for ${podsReferencedByCommit}`);
    }
 
    // If changes were made to the release notes, there must also be changes to the AppStoreStrings file.
    const hasModifiedReleaseNotes = modifiedFiles.some(f => f.endsWith("Resources/release_notes.txt"));
    const hasModifiedAppStoreStrings = modifiedFiles.some(f => f.includes("Resources/AppStoreStrings.po"));

    if (hasModifiedReleaseNotes && !hasModifiedAppStoreStrings) {
        warn("The AppStoreStrings.po file must be updated any time changes are made to release notes");
    }

    // Let users know that we're skipping tests on release PRs
    const isReleasePr = (githubLabels.length != 0) && githubLabels.some(label => label.name.includes("Releases"));
    if (isReleasePr) {
        message("This PR has the 'Releases' label: some checks will be skipped.");
    }

    // Changes to Resources/en.lproj/Localizable.strings should only be made on release branches since this file is
    // generated by our scripts
    const hasModifiedStrings = modifiedFiles.some(f => f.endsWith("Resources/en.lproj/Localizable.strings"));
    const isReleaseBranch = pr.head.ref.startsWith("release/");

    if (hasModifiedStrings && !isReleaseBranch && !isReleasePr) {
        warn("Localizable.strings should only be updated on release branches because it is generated automatically.");
    }
};
