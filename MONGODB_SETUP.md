# MongoDB Atlas Setup for Persistent Trade Storage

## Why MongoDB?

On Render, the filesystem is **ephemeral** - files are wiped on every deployment. This means your trades won't persist between deployments.

**Solution:** Use MongoDB Atlas (free tier) for persistent storage.

## Quick Setup (5 minutes)

### Step 1: Create MongoDB Atlas Account

1. Go to https://www.mongodb.com/cloud/atlas/register
2. Sign up for free account
3. Choose the **FREE** tier (M0 Sandbox)

### Step 2: Create a Cluster

1. Click "Build a Database"
2. Choose **FREE** tier (M0)
3. Select a cloud provider (AWS recommended)
4. Choose a region close to you
5. Click "Create"

### Step 3: Create Database User

1. Go to "Database Access" in left menu
2. Click "Add New Database User"
3. Username: `tradingbot` (or any name)
4. Password: Generate a strong password (save it!)
5. Database User Privileges: "Read and write to any database"
6. Click "Add User"

### Step 4: Whitelist IP Address

1. Go to "Network Access" in left menu
2. Click "Add IP Address"
3. Click "Allow Access from Anywhere" (for Render)
   - Or add Render's IP ranges if you want to be more secure
4. Click "Confirm"

### Step 5: Get Connection String

1. Go to "Database" in left menu
2. Click "Connect" on your cluster
3. Choose "Connect your application"
4. Driver: **Node.js**
5. Version: **5.5 or later**
6. Copy the connection string

It will look like:
```
mongodb+srv://tradingbot:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

### Step 6: Add to Render Environment Variables

1. Go to your Render dashboard
2. Select your service
3. Go to "Environment" tab
4. Click "Add Environment Variable"
5. Key: `MONGODB_URI`
6. Value: Paste your connection string
   - **Important:** Replace `<password>` with your actual password
   - Example: `mongodb+srv://tradingbot:MyPassword123@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
7. Click "Save Changes"
8. Redeploy your service

## How It Works

Once `MONGODB_URI` is set:

1. **Bot starts** → Connects to MongoDB
2. **Trades saved** → Stored in MongoDB (survives deployments!)
3. **Bot restarts** → Loads trades from MongoDB
4. **Deployment** → Trades persist! ✅

## Fallback

If MongoDB is not configured:
- Bot uses file system (works locally, but not on Render)
- Logs will show helpful messages

## Free Tier Limits

MongoDB Atlas FREE tier includes:
- ✅ 512 MB storage (plenty for trades)
- ✅ Shared RAM
- ✅ No credit card required
- ✅ Perfect for this use case

## Troubleshooting

**Connection failed?**
- Check your password in the connection string
- Verify IP whitelist includes "0.0.0.0/0" (all IPs)
- Check MongoDB Atlas dashboard for connection logs

**Trades not loading?**
- Check Render logs for MongoDB connection status
- Verify `MONGODB_URI` environment variable is set correctly
- Make sure you replaced `<password>` with actual password

## Security Note

The connection string includes your password. Keep it secure:
- ✅ Store in Render environment variables (encrypted)
- ❌ Don't commit to Git
- ❌ Don't share publicly

## That's It!

Once set up, your trades will persist across deployments! 🎉

