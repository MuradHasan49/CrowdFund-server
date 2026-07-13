import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const testUsers = async () => {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const userSchema = new mongoose.Schema({}, { strict: false });
  const UserModel = mongoose.models.User || mongoose.model('User', userSchema);
  
  const users = await UserModel.find({}).lean();
  console.log(users.map(u => ({ id: u._id.toString(), email: u.email })));
  process.exit(0);
};

testUsers();
