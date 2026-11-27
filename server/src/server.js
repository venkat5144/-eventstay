import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import cors from "cors";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { z } from "zod";
import { pool, query, initDb } from "./db.js";
const app=express();
app.use(helmet());
const allowedOrigins=(process.env.CLIENT_ORIGIN||"http://localhost:3000,http://127.0.0.1:5500").split(",").map(v=>v.trim()).filter(Boolean);
app.use(cors({origin(origin,callback){if(!origin||allowedOrigins.includes(origin))return callback(null,true);return callback(new Error("Origin not allowed"))},credentials:false}));
app.use(express.json({limit:"2mb"}));
const secret=process.env.JWT_SECRET;
if(!secret||secret.length<32) throw new Error("JWT_SECRET must be at least 32 characters");
const auth=(req,res,next)=>{try{const t=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");req.user=jwt.verify(t,secret);next()}catch{return res.status(401).json({error:"Authentication required"})}};
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const idSchema=z.string().uuid();
app.get("/api/health",wrap(async(req,res)=>{await query("SELECT 1");res.json({ok:true,service:"eventstay-api",database:"connected"})}));
const authLimiter=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:"draft-7",legacyHeaders:false,message:{error:"Too many authentication attempts. Try again later."}});
app.post("/api/auth/register",authLimiter,wrap(async(req,res)=>{
 const s=z.object({name:z.string().trim().min(2).max(120),email:z.string().email().max(254),password:z.string().min(10).max(128)}).strict().parse(req.body);
 const hash=await bcrypt.hash(s.password,12);
 const {rows}=await query("INSERT INTO organizers(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role",[s.name,s.email.toLowerCase(),hash,"organizer"]);
 const user=rows[0],token=jwt.sign({sub:user.id,role:user.role},secret,{expiresIn:"12h"});
 res.status(201).json({user,token});
}));
app.post("/api/auth/login",authLimiter,wrap(async(req,res)=>{
 const s=z.object({email:z.string().email(),password:z.string()}).parse(req.body);
 const {rows}=await query("SELECT id,name,email,password_hash,role FROM organizers WHERE email=$1",[s.email.toLowerCase()]);
 if(!rows[0]||!await bcrypt.compare(s.password,rows[0].password_hash))return res.status(401).json({error:"Invalid email or password"});
 const {password_hash,...user}=rows[0];res.json({user,token:jwt.sign({sub:user.id,role:user.role},secret,{expiresIn:"12h"})});
}));
app.get("/api/me",auth,wrap(async(req,res)=>{const {rows}=await query("SELECT id,name,email,role FROM organizers WHERE id=$1",[req.user.sub]);res.json({user:rows[0]||null})}));
app.use("/api",auth);
app.get("/api/events",wrap(async(req,res)=>{const {rows}=await query("SELECT * FROM events WHERE organizer_id=$1 ORDER BY created_at DESC",[req.user.sub]);res.json(rows)}));
app.post("/api/events",wrap(async(req,res)=>{const s=z.object({name:z.string().min(2),bride_name:z.string().optional(),groom_name:z.string().optional(),starts_on:z.string().optional(),ends_on:z.string().optional(),venue_name:z.string().optional(),venue_address:z.string().optional()}).parse(req.body);const {rows}=await query("INSERT INTO events(organizer_id,name,bride_name,groom_name,starts_on,ends_on,venue_name,venue_address) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[req.user.sub,s.name,s.bride_name||null,s.groom_name||null,s.starts_on||null,s.ends_on||null,s.venue_name||null,s.venue_address||null]);res.status(201).json(rows[0])}));
app.get("/api/hotels",wrap(async(req,res)=>{const {rows}=await query("SELECT * FROM hotels WHERE organizer_id=$1 ORDER BY name",[req.user.sub]);res.json(rows)}));
app.post("/api/hotels",wrap(async(req,res)=>{const s=z.object({name:z.string().min(2),phone:z.string().optional(),address:z.string().optional()}).parse(req.body);const {rows}=await query("INSERT INTO hotels(organizer_id,name,phone,address) VALUES($1,$2,$3,$4) RETURNING *",[req.user.sub,s.name,s.phone||null,s.address||null]);res.status(201).json(rows[0])}));
app.get("/api/hotels/:hotelId/rooms",wrap(async(req,res)=>{const {rows}=await query("SELECT r.* FROM rooms r JOIN hotels h ON h.id=r.hotel_id WHERE h.id=$1 AND h.organizer_id=$2 ORDER BY r.floor,r.room_number",[req.params.hotelId,req.user.sub]);res.json(rows)}));
app.post("/api/hotels/:hotelId/rooms",wrap(async(req,res)=>{const s=z.object({room_number:z.string().min(1),floor:z.string().optional(),capacity:z.number().int().positive()}).parse(req.body);const owns=await query("SELECT id FROM hotels WHERE id=$1 AND organizer_id=$2",[req.params.hotelId,req.user.sub]);if(!owns.rowCount)return res.status(404).json({error:"Hotel not found"});const {rows}=await query("INSERT INTO rooms(hotel_id,room_number,floor,capacity) VALUES($1,$2,$3,$4) RETURNING *",[req.params.hotelId,s.room_number,s.floor||null,s.capacity]);res.status(201).json(rows[0])}));
app.get("/api/events/:eventId/hotels",wrap(async(req,res)=>{const {rows}=await query("SELECT h.*,eh.created_at AS linked_at FROM event_hotels eh JOIN hotels h ON h.id=eh.hotel_id JOIN events e ON e.id=eh.event_id WHERE eh.event_id=$1 AND e.organizer_id=$2 ORDER BY h.name",[req.params.eventId,req.user.sub]);res.json(rows)}));
app.post("/api/events/:eventId/hotels",wrap(async(req,res)=>{const s=z.object({hotel_id:idSchema}).parse(req.body);const {rows}=await query("INSERT INTO event_hotels(event_id,hotel_id) SELECT e.id,h.id FROM events e JOIN hotels h ON h.id=$2 AND h.organizer_id=$3 WHERE e.id=$1 AND e.organizer_id=$3 RETURNING *",[req.params.eventId,s.hotel_id,req.user.sub]);if(!rows[0])return res.status(404).json({error:"Event or hotel not found"});res.status(201).json(rows[0])}));
app.delete("/api/events/:eventId/hotels/:hotelId",wrap(async(req,res)=>{const {rowCount}=await query("DELETE FROM event_hotels eh USING events e,hotels h WHERE eh.event_id=e.id AND eh.hotel_id=h.id AND eh.event_id=$1 AND eh.hotel_id=$2 AND e.organizer_id=$3 AND h.organizer_id=$3",[req.params.eventId,req.params.hotelId,req.user.sub]);if(!rowCount)return res.status(404).json({error:"Event hotel link not found"});res.status(204).end()}));
app.get("/api/events/:eventId/guests",wrap(async(req,res)=>{const {rows}=await query("SELECT g.*,i.status AS invitation_status FROM guests g LEFT JOIN invitations i ON i.guest_id=g.id WHERE g.event_id=$1 AND EXISTS(SELECT 1 FROM events e WHERE e.id=g.event_id AND e.organizer_id=$2) ORDER BY g.created_at DESC",[req.params.eventId,req.user.sub]);res.json(rows)}));
app.post("/api/events/:eventId/guests",wrap(async(req,res)=>{const s=z.object({name:z.string().trim().min(1).max(160),phone:z.string().max(30).optional(),address:z.string().max(500).optional(),side:z.enum(["Bride","Groom","Both families","Friends","Colleagues","Other"]).default("Other"),guest_count:z.number().int().positive().max(100).default(1),adult_count:z.number().int().nonnegative().max(100).optional(),child_count:z.number().int().nonnegative().max(100).default(0),family_group_id:idSchema.optional(),photo_url:z.string().url().optional()}).superRefine((v,ctx)=>{const adults=v.adult_count??v.guest_count;if(adults+v.child_count!==v.guest_count)ctx.addIssue({code:"custom",message:"Adult and child counts must equal total guest count",path:["guest_count"]})}).parse(req.body);const own=await query("SELECT id FROM events WHERE id=$1 AND organizer_id=$2",[req.params.eventId,req.user.sub]);if(!own.rowCount)return res.status(404).json({error:"Event not found"});if(s.family_group_id){const family=await query("SELECT id FROM family_groups WHERE id=$1 AND event_id=$2",[s.family_group_id,req.params.eventId]);if(!family.rowCount)return res.status(400).json({error:"Family group does not belong to this event"});}const client=await pool.connect();try{await client.query("BEGIN");const g=await client.query("INSERT INTO guests(event_id,name,phone,address,side,guest_count,photo_url,adult_count,child_count,family_group_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",[req.params.eventId,s.name,s.phone||null,s.address||null,s.side,s.guest_count,s.photo_url||null,s.adult_count??s.guest_count,s.child_count,s.family_group_id||null]);await client.query("INSERT INTO invitations(guest_id) VALUES($1)",[g.rows[0].id]);const token=crypto.randomBytes(32).toString("hex");await client.query("INSERT INTO qr_passes(guest_id,token_hash) VALUES($1,$2)",[g.rows[0].id,crypto.createHash("sha256").update(token).digest("hex")]);await client.query("COMMIT");res.status(201).json({...g.rows[0],qr_token:token})}catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}}));
app.get("/api/events/:eventId/families",wrap(async(req,res)=>{const {rows}=await query("SELECT * FROM family_groups WHERE event_id=$1 AND EXISTS(SELECT 1 FROM events e WHERE e.id=$1 AND e.organizer_id=$2) ORDER BY name",[req.params.eventId,req.user.sub]);res.json(rows)}));
app.post("/api/events/:eventId/families",wrap(async(req,res)=>{const s=z.object({name:z.string().trim().min(1).max(120),side:z.enum(["Bride","Groom","Both families","Friends","Colleagues","Other"]).default("Other")}).parse(req.body);const {rows}=await query("INSERT INTO family_groups(event_id,name,side) SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM events WHERE id=$1 AND organizer_id=$4) RETURNING *",[req.params.eventId,s.name,s.side,req.user.sub]);if(!rows[0])return res.status(404).json({error:"Event not found"});res.status(201).json(rows[0])}));
app.get("/api/hotels/:hotelId/buildings",wrap(async(req,res)=>{const {rows}=await query("SELECT b.* FROM buildings b JOIN hotels h ON h.id=b.hotel_id WHERE h.id=$1 AND h.organizer_id=$2 ORDER BY b.name",[req.params.hotelId,req.user.sub]);res.json(rows)}));
app.post("/api/hotels/:hotelId/buildings",wrap(async(req,res)=>{const s=z.object({name:z.string().trim().min(1).max(100)}).parse(req.body);const {rows}=await query("INSERT INTO buildings(hotel_id,name) SELECT $1,$2 WHERE EXISTS(SELECT 1 FROM hotels WHERE id=$1 AND organizer_id=$3) RETURNING *",[req.params.hotelId,s.name,req.user.sub]);if(!rows[0])return res.status(404).json({error:"Hotel not found"});res.status(201).json(rows[0])}));
app.get("/api/buildings/:buildingId/floors",wrap(async(req,res)=>{const {rows}=await query("SELECT f.* FROM floors f JOIN buildings b ON b.id=f.building_id JOIN hotels h ON h.id=b.hotel_id WHERE b.id=$1 AND h.organizer_id=$2 ORDER BY f.name",[req.params.buildingId,req.user.sub]);res.json(rows)}));
app.post("/api/buildings/:buildingId/floors",wrap(async(req,res)=>{const s=z.object({name:z.string().trim().min(1).max(100)}).parse(req.body);const {rows}=await query("INSERT INTO floors(building_id,name) SELECT $1,$2 WHERE EXISTS(SELECT 1 FROM buildings b JOIN hotels h ON h.id=b.hotel_id WHERE b.id=$1 AND h.organizer_id=$3) RETURNING *",[req.params.buildingId,s.name,req.user.sub]);if(!rows[0])return res.status(404).json({error:"Building not found"});res.status(201).json(rows[0])}));
app.patch("/api/invitations/:id",wrap(async(req,res)=>{const s=z.object({status:z.enum(["pending","sent","delivered","responded"])}).parse(req.body);const {rows}=await query("UPDATE invitations i SET status=$1,sent_at=CASE WHEN $1='sent' THEN now() ELSE sent_at END FROM guests g JOIN events e ON e.id=g.event_id WHERE i.id=$2 AND i.guest_id=g.id AND e.organizer_id=$3 RETURNING i.*",[s.status,req.params.id,req.user.sub]);if(!rows[0])return res.status(404).json({error:"Invitation not found"});res.json(rows[0])}));
app.get("/api/dashboard/:eventId",wrap(async(req,res)=>{const owned=await query("SELECT id FROM events WHERE id=$1 AND organizer_id=$2",[req.params.eventId,req.user.sub]);if(!owned.rowCount)return res.status(404).json({error:"Event not found"});const {rows}=await query(`SELECT (SELECT count(*) FROM guests WHERE event_id=$1)::int total_guests,(SELECT coalesce(sum(guest_count),0) FROM guests WHERE event_id=$1)::int people_count,(SELECT count(*) FROM invitations i JOIN guests g ON g.id=i.guest_id WHERE g.event_id=$1 AND i.status='sent')::int invitations_sent,(SELECT count(*) FROM invitations i JOIN guests g ON g.id=i.guest_id WHERE g.event_id=$1 AND i.status='pending')::int invitations_pending,(SELECT count(*) FROM allocations a JOIN guests g ON g.id=a.guest_id WHERE g.event_id=$1 AND a.status='checked_in')::int checked_in`,[req.params.eventId]);res.json(rows[0])}));

app.post("/api/allocations",wrap(async(req,res)=>{
 const s=z.object({guest_id:z.string().uuid(),room_id:z.string().uuid(),check_in:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),check_out:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),guest_count:z.number().int().positive()}).parse(req.body);
 if(new Date(s.check_out)<=new Date(s.check_in))return res.status(400).json({error:"Check-out must be after check-in"});
 const c=await pool.connect();try{await c.query("BEGIN");
 const room=await c.query("SELECT r.capacity,h.organizer_id FROM rooms r JOIN hotels h ON h.id=r.hotel_id WHERE r.id=$1 FOR UPDATE",[s.room_id]);
 if(!room.rowCount||room.rows[0].organizer_id!==req.user.sub){await c.query("ROLLBACK");return res.status(404).json({error:"Room not found"})}
 const guest=await c.query("SELECT g.id,g.guest_count,g.event_id FROM guests g JOIN events e ON e.id=g.event_id WHERE g.id=$1 AND e.organizer_id=$2",[s.guest_id,req.user.sub]);
 if(!guest.rowCount){await c.query("ROLLBACK");return res.status(404).json({error:"Guest not found"})}
 const linked=await c.query("SELECT 1 FROM event_hotels WHERE event_id=$1 AND hotel_id=(SELECT hotel_id FROM rooms WHERE id=$2)",[guest.rows[0].event_id,s.room_id]);
 if(!linked.rowCount){await c.query("ROLLBACK");return res.status(400).json({error:"Link this hotel to the guest's event before allocating rooms"})}
 const guestAllocated=await c.query("SELECT coalesce(sum(guest_count),0)::int n FROM allocations WHERE guest_id=$1 AND status<>'cancelled' AND check_in<$3 AND check_out>$2",[s.guest_id,s.check_in,s.check_out]);
 if(guestAllocated.rows[0].n+s.guest_count>guest.rows[0].guest_count){await c.query("ROLLBACK");return res.status(400).json({error:"Total allocated guests cannot exceed the booking count",alreadyAllocated:guestAllocated.rows[0].n})}
 const used=await c.query("SELECT coalesce(sum(guest_count),0)::int n FROM allocations WHERE room_id=$1 AND status<>'cancelled' AND check_in<$3 AND check_out>$2",[s.room_id,s.check_in,s.check_out]);
 if(used.rows[0].n+s.guest_count>room.rows[0].capacity){await c.query("ROLLBACK");return res.status(409).json({error:"Room capacity exceeded",available:room.rows[0].capacity-used.rows[0].n})}
 const {rows}=await c.query("INSERT INTO allocations(guest_id,room_id,check_in,check_out,guest_count) VALUES($1,$2,$3,$4,$5) RETURNING *",[s.guest_id,s.room_id,s.check_in,s.check_out,s.guest_count]);
 await c.query("COMMIT");res.status(201).json(rows[0]);
 }catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}
}));
app.get("/api/allocations",wrap(async(req,res)=>{const {rows}=await query("SELECT a.*,g.name guest_name,g.event_id,r.room_number,h.id hotel_id,h.name hotel_name,h.address hotel_address FROM allocations a JOIN guests g ON g.id=a.guest_id JOIN events e ON e.id=g.event_id JOIN rooms r ON r.id=a.room_id JOIN hotels h ON h.id=r.hotel_id WHERE e.organizer_id=$1 ORDER BY a.check_in",[req.user.sub]);res.json(rows)}));
app.post("/api/check-in/verify",wrap(async(req,res)=>{
 const s=z.object({token:z.string().min(20)}).parse(req.body);
 const hash=crypto.createHash("sha256").update(s.token).digest("hex");
 const {rows}=await query("SELECT q.guest_id,g.name,a.id allocation_id,a.status,a.check_in,a.check_out FROM qr_passes q JOIN guests g ON g.id=q.guest_id JOIN events e ON e.id=g.event_id LEFT JOIN allocations a ON a.guest_id=g.id AND a.status IN ('reserved','checked_in') WHERE q.token_hash=$1 AND q.active=true AND e.organizer_id=$2 ORDER BY a.created_at DESC",[hash,req.user.sub]);
 if(!rows.length)return res.status(404).json({error:"Invalid or inactive QR pass"});
 const matches=rows.filter(x=>x.allocation_id);if(!matches.length)return res.status(409).json({error:"Guest has no active room allocation"});
 if(matches.length>1)return res.status(409).json({error:"This guest has multiple active room allocations. Select a room allocation before check-in.",allocations:matches.map(x=>({id:x.allocation_id,status:x.status,check_in:x.check_in,check_out:x.check_out}))});
 const a=matches[0];
 if(a.status==="checked_in")return res.status(409).json({error:"Guest is already checked in"});
 const c=await pool.connect();try{await c.query("BEGIN");const changed=await c.query("UPDATE allocations SET status='checked_in' WHERE id=$1 AND status='reserved' RETURNING id",[a.allocation_id]);if(!changed.rowCount){await c.query("ROLLBACK");return res.status(409).json({error:"This allocation is no longer available for check-in"})}await c.query("INSERT INTO checkins(allocation_id,action,recorded_by) VALUES($1,'check_in',$2)",[a.allocation_id,req.user.sub]);await c.query("COMMIT");res.json({ok:true,guest:a.name,allocation_id:a.allocation_id,status:"checked_in"})}catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}
}));
app.post("/api/check-in/:allocationId/checkout",wrap(async(req,res)=>{
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const {rows}=await c.query("UPDATE allocations a SET status='checked_out' FROM guests g JOIN events e ON e.id=g.event_id WHERE a.id=$1 AND a.guest_id=g.id AND e.organizer_id=$2 AND a.status='checked_in' RETURNING a.*",[req.params.allocationId,req.user.sub]);
  if(!rows[0]){await c.query("ROLLBACK");return res.status(404).json({error:"Active check-in not found"})}
  await c.query("INSERT INTO checkins(allocation_id,action,recorded_by) VALUES($1,'check_out',$2)",[rows[0].id,req.user.sub]);
  await c.query("COMMIT");res.json(rows[0]);
 }catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}
}));

app.use((err,req,res,next)=>{console.error(err);if(err instanceof z.ZodError)return res.status(400).json({error:"Validation failed",details:err.issues});if(err.code==="23505")return res.status(409).json({error:"This record already exists"});res.status(500).json({error:process.env.NODE_ENV==="production"?"Internal server error":err.message})});
const port=Number(process.env.PORT||5000);
await initDb();app.listen(port,()=>console.log("EventStay API listening on "+port));
process.on("SIGTERM",async()=>{await pool.end();process.exit(0)});
