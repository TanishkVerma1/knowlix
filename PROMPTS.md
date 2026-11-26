# Prompt log

The main AI prompts Team Knowlix used to plan and build this website, in the order we used them. The tool was Claude Code. Prompts are quoted as written, with lightly trimmed whitespace.

The prompts Knowlix itself sends to its AI roles at runtime are a separate thing. Those are the Planner, Finder, Writer, Judge and Critic personas, documented in [`docs/AGENT_PERSONAS.md`](docs/AGENT_PERSONAS.md).

---

## Phase 1: planning (before 26 Nov)

1. **Analyse the brief and research the market.**
   > "Now i have a hackathon in my college in 2 days and i have attached each and everything for your understanding. i want you to go through every image and then research some existing solution if available online and identify their gaps and all. Now there are 2 documents in the folder that my team member has sent. Go through these documents also. … create a document to list all the improvements that should be made to both of these documents so that we are making this as a extremely extraordinary project … All the marks in phase 1 is given to you … also phase 2 requirements grading system is also given … add a section in the document in which you will include possibilities that would be given to us to add or fine tune this system"

2. **Deliver the plan as a PDF.**
   > "also i dont want an artifact i want you to make a pdf of that file."

3. **Rework against the official guidelines.**
   > "there is folder in which there are guidelines document. now read them and then again work on improvements of project"

4. **Explain the whole system, including the multi-agent architecture.**
   > "alright now i need you to explain me each and everything we are doing in this project like what we are going to build and how, are we going to make multi agent architecture, etc.. every detail about the project.."

5. **Merge teammates' suggestions.**
   > "Alright these are statements told by my other two team mates i want you check if everything related to these were considered for our document or not: …" then "yes update the document.."

6. **Review the Phase 1 deck against the plan.**
   > "now i teammate has made the knowlix phase 1 deck tell me is it according to our finalized improvement plan … or there are any improvements to be made, etc." then "ok now if there are things to be changed in my document according to the html then go ahead and do it.."

7. **Plan an implementation that can be demoed.**
   > "Also tell me how you are going to implement this project to make it extraordinary, easy to understand, things working perfectly. and also make sure that when i am showing the project then i can show a demo to the people of working of our project."

8. **Benchmark against existing tools.**
   > "also you have seen how the mendeley, zotero, research rabbit, scispace work right and have understood how we have to make this project accordingly to that right?"

## Phase 1: building the first version (25 Nov)

9. **Build it, with personas and guardrails.**
   > "i said the project shouild be extraordinary exceptionally well dont work on it based on the level of the presentation/deck. the ui/ux has to be exceptionally good and error free. also i have docker desktop for you to use.. also if you can give personals to agent, guardrails, etc so that agent works properly then do that also.. go ahead and create this extremely well, extraordinary working and looking, no issues and faults, etc project."

10. **Structure the code.**
    > "also if you feel like structuring like frontend backend, etc then you can"

11. **Design decisions (answered in a structured questionnaire).**
    - Sign-in: *"Private workspace, no sign-in."*
    - AI keys: *"None yet."* (build with a mock AI and a no-AI mode)
    - Demo scene: *"Projector or big screen in a hall."*
    - Visual direction: *"make it the best as per you … plan it yourself"*

12. **Make the agents' design visible.**
    > "and the agents md file doesnt have the personas for the agents? how would i know whether agents have personas and guardrails, etc"

13. **Test it hard, explain the verdicts, show the agents working (25 Nov, evening).**
    > "Now i need you to test the project and also check whether the project right now is good for various edge cases. and make sure that all things that are required from this hackathon phase 1 are in this project and also ready for phase 2. tell me whether dataset is used in this project if yes then where can i see it. where have we taken it from. do we need to have more data for training and testing with various edge cases, for making this a better project. Also the reasons for verifying, mismatch and please check, should be easily understandable. i mean i didnt understand why it is retracted and also when everything is scoring marks in the field by field. Also is there a better way where we can see that the agents are running. How can we overcome the limitations listed in the project. […] also this is a live project i should see the project running the agents working and their outputs clearly."

    What came out of it:
    - An adversarial edge-case test pass (2 critical and 16 major defects found and fixed, including a way to turn a retracted paper "Verified").
    - A 300-reference test set built from random Crossref and DataCite records, browsable inside the app.
    - "Why this stamp?": three plain questions on every reference (does it exist, do the details match, is it safe to cite).
    - A live agent room that streams each AI agent's answer as it is typed, on a real model.
    - More databases (Europe PMC, Semantic Scholar, arXiv, Google Books) and full-text checking for free-to-read papers.
    - A Draft page: the student writes, Knowlix inserts citations from the checked library and flags copied wording.

## 26 Nov, morning: before the day-of brief

14. **A new look, with nothing else allowed to break.**
    > "I wanted you to change the look and feel also. so please redesign to make this extraordinary project but remember nothing else like the working and all should not break. then also tell me what api you need and where to put it."

    What came out of it: the "registrar's record" look (ink-teal shell, wide heavy titles on a braided rule, colour reserved for verdicts), applied through shared design tokens so no behaviour changed. The full test suite and the end-to-end checks were re-run afterwards.

15. **Documents and links.**
    > "continue.. and also i heard my other peers at the hackathon saying they can upload documents, links, etc so is my project doing if not then i think we have fullfilled all the requirements of the hackathon."

    What came out of it: a pasted link is read on the server (private network addresses are refused) and checked by its DOI; a PDF is read on the student's own device and never uploaded; an essay PDF's reference list can be lifted straight into the audit.

16. **Privacy of the contact email.**
    > "should i put my personal email in the env file?"

    What came out of it: the answer was no (use a team address), and a fix: the contact address is now sent only to the scholarly databases, never to an arbitrary web page a student pastes.

17. **Sign-ups.**
    > "guide me for getting api of openalex"

18. **Will free API keys cope?**
    > "also as i have the free keys and i saw the agents given the max tokens is it not a lot as per the free api keys that i am giving?"

    What came out of it: Groq's documentation showed the model the app asked for had been switched off for free accounts, and that the free allowance is small per minute. The app now uses Groq's current models, sends a shorter reading list when the allowance is small, moves to the next model when one says "slow down", and waits briefly instead of failing. Tested first with simulated replies, then live.

## Phase 2: day-of adaptation (26 Nov, 1:30 to 3:00 PM)

19. **The day-of brief, pasted in full, with one instruction.**
    > "Also this is the phase 2: [the five requirements, the phone constraint and the demo rules, pasted as received] So go ahead and work on this also."

    Follow-ups while it was being built:
    > "groq key and the gemini key was already updated and if you want a third key from nvidea i can give you that also"

    > "before the research using api keys you can go ahead and implement phase 2 and then test everything"

    What changed, requirement by requirement, and why:

    | Requirement | Already there | Changed today | Why |
    |---|---|---|---|
    | 1. Fake reference test | Every reference is checked live against doi.org, Crossref and OpenAlex by code. A made-up DOI is stamped Mismatch and refused. | A made-up title or author is now stamped **Not found** instead of the vaguer "Please check". If the databases do not answer, the stamp is **Not yet verified**. | The brief asks that a fake is clearly shown as unverifiable. "Please check" did not say why. |
    | 2. Trust labels on everything | References carry a stamp; AI sentences carry Verified, Reported, AI reasoning or Not found. | A "What the labels mean" guide on the audit, library, sources and summary screens. Sources the AI recommends carry an **AI suggestion** label. | The brief asks for the labels to be explained on screen, not on a separate help page. |
    | 3. The user approves | Three checkpoints in research; "Save to library" in the audit. | The library now checks first and shows the result; nothing is saved until **Approve and add to my references** is clicked. In research no source starts ticked: each one is approved with one click (or all suggestions with one click). | Before, a reference typed into the library was saved as soon as it passed the check, and the AI's picks arrived pre-ticked. Both could be read as "added automatically". |
    | 4. Export in APA 7 | Six styles through the official Citation Style Language, APA first, copy and download. | The style is named "APA 7th edition" in full; long links wrap on a phone. | So a judge sees the exact edition asked for. |
    | 5. AI use statement | Generated at the end of a research run from what actually happened. | The same kind of statement now comes with every reference-list export (audit and library), with its own copy button. | A student who only checks a list, and never runs the research assistant, still needs a statement. |
    | Phone screen | Responsive layout with a drawer menu. | The label guide folds away on a phone; the cite dialog no longer clips. Checked in a browser at 390 px wide: no sideways scrolling on the home, library, audit, sources or summary screens. | The judges may open the site on a phone. |

20. _Add any further prompt used during the 90 minutes here._
