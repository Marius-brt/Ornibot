const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const mysql = require("mysql");
const util = require("util");
const { Webhook, MessageBuilder } = require("discord-webhook-node");
const hook = new Webhook(process.env.WEBHOOK);
const cron = require("node-cron");

hook.send("Yo!");

run();

cron.schedule("0 * * * *", () => {
  run();
});

hook.setUsername("Ornibot");
hook.setAvatar(
  "https://finance-et-compagnies.com/storage/media/1133/YvbNuQUB_400x400.png"
);

puppeteer.use(StealthPlugin());

process.on("exit", () => {
  hook.send(
    "@everyone Oups on dirait que j'ai bug quelqu'un pour me réparer ?"
  );
});

let messages = [];

const conn = mysql.createConnection({
  port: process.env.SQL_PORT,
  host: process.env.SQL_HOST,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASS,
  database: process.env.SQL_DB,
});
const query = util.promisify(conn.query).bind(conn);

setInterval(() => {
  if (messages.length > 0) {
    hook.send(messages[0]);
    messages.shift();
  }
}, 2000);

function run() {
  let teachers = [];
  let lessons = {};
  puppeteer.launch({ headless: true }).then(async (browser) => {
    const page = await browser.newPage();
    page.on("response", async (response) => {
      if (response.url() == "https://app-gateway.ornikar.com/graphql") {
        try {
          const data = await response.json();
          if (
            checkGraph(
              data,
              "data.currentUser.journey.drivingState.teachingStaff"
            )
          ) {
            teachers = data.data.currentUser.journey.drivingState.teachingStaff;
          }
          if (teachers.length > 0) {
            const reqBody = JSON.parse(await response.request().postData());
            if (checkGraph(reqBody, "variables.input.instructorId")) {
              lessons[reqBody.variables.input.instructorId] =
                data.data.instructorNextLessonsInterval;
            }
          }
        } catch (ex) {}
      }
    });
    await page.goto("https://app.ornikar.com/connexion");
    await page.type("#email", process.env.EMAIL);
    await page.type("#password", process.env.PASSWORD);
    await page.keyboard.press("Enter");
    await page.waitForNavigation({ waituntil: "domcontentloaded" });
    await page.goto("https://app.ornikar.com/planning");
    await page.waitForTimeout(4000);
    for await (const [key, value] of Object.entries(lessons)) {
      for await (lesson of value) {
        const date = convertTZ(lesson.startsAt, lesson.meetingPoint.timezone);
        const now = new Date();
        const diff = Math.ceil(Math.abs(date - now) / (1000 * 60 * 60 * 24));
        if (diff <= process.env.MAXDELAY) {
          const exist = await query("SELECT * FROM lessons WHERE id=?", [
            parseInt(lesson.id),
          ]);
          if (exist.length === 0) {
            const teacher = teachers.find((el) => el.id == key);
            messages.push(
              new MessageBuilder()
                .setText("@everyone")
                .setTitle("Nouveau créneau !")
                .addField(
                  "Moniteur",
                  `${teacher.firstname} ${teacher.lastname}`
                )
                .addField(
                  "Date",
                  `${twoDigit(date.getDate())}/${twoDigit(
                    date.getMonth()
                  )}/${date.getFullYear()} à ${twoDigit(
                    date.getHours()
                  )}h${twoDigit(date.getMinutes())}`
                )
                .addField("Adresse", lesson.meetingPoint.name)
                .setColor("#00b0f4")
            );
            await query(
              "INSERT INTO `lessons`(`id`, `name`, `address`, `date`) VALUES (?,?,?,?)",
              [
                parseInt(lesson.id),
                `${teacher.firstname} ${teacher.lastname}`,
                lesson.meetingPoint.name,
                convertTZ(lesson.startsAt, lesson.meetingPoint.timezone),
              ]
            );
          }
        }
      }
    }
    await browser.close();
  });
}

function checkGraph(obj, graphPath) {
  var parts = graphPath.split(".");
  var root = obj;
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (root[part] && root.hasOwnProperty(part)) root = root[part];
    else return false;
  }
  return true;
}

function convertTZ(date, tzString) {
  return new Date(
    (typeof date === "string" ? new Date(date) : date).toLocaleString("en-US", {
      timeZone: tzString,
    })
  );
}

function twoDigit(number) {
  return ("0" + number).slice(-2);
}
