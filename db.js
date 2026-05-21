import mongoose from "mongoose";

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://ORBITDB:a3_1M21Pdp0pAsDrB90k@nectar-a:27021,nectar-b:27021,nectar-c:27021/ORBITDB";

const MONGO_DB_NAME =
  process.env.MONGO_DB_NAME || "ORBITDB";

let isConnected = false;

export async function connectDB() {

  if (isConnected) {
    console.log("🟢 Mongo already connected");
    return mongoose.connection;
  }

  if (!MONGO_URI) {
    throw new Error(
      "Missing MONGO_URI in .env"
    );
  }

  try {

    await mongoose.connect(
      MONGO_URI,
      {
        dbName: MONGO_DB_NAME,

        autoIndex: true,

        maxPoolSize: 20,

        minPoolSize: 5,

        serverSelectionTimeoutMS: 10000,

        socketTimeoutMS: 45000
      }
    );

    isConnected = true;

    console.log(
      "✅ Mongo connected:",
      MONGO_DB_NAME
    );

    mongoose.connection.on(
      "disconnected",
      () => {

        console.warn(
          "⚠️ Mongo disconnected"
        );

        isConnected = false;
      }
    );

    mongoose.connection.on(
      "reconnected",
      () => {

        console.log(
          "🔄 Mongo reconnected"
        );

        isConnected = true;
      }
    );

    mongoose.connection.on(
      "error",
      (err) => {

        console.error(
          "❌ Mongo error:",
          err
        );
      }
    );

    return mongoose.connection;

  } catch (err) {

    console.error(
      "💥 Mongo connection failed:",
      err
    );

    isConnected = false;

    throw err;
  }
}

export async function disconnectDB() {

  if (!isConnected) {
    return;
  }

  await mongoose.disconnect();

  isConnected = false;

  console.log("🔌 Mongo disconnected");
}

export default connectDB;