const { app,BrowserWindow, ipcMain }=require("electron");
const sqlite=require("sqlite3").verbose();

const path = require('path') 
const env = process.env.NODE_ENV || 'development';

const ThermalPrinter=require("node-thermal-printer").printer;
const PrinterTypes=require("node-thermal-printer").types;

var printer=new ThermalPrinter({
    type:PrinterTypes.EPSON,
    interface:"\\.\COM1",
    characterSet:"SLOVENIA",
    removeSpecialCharacters:false,
    lineCharacter:"=",
    options:{
        timeout:10000
    }
});

// If development environment 
// if (env === 'development') { 
//     require('electron-reload')(__dirname, { 
//         electron: path.join(__dirname, 'node_modules', '.bin', 'electron'), 
//         hardResetMethod: 'exit'
//     }); 
// }

let db=new sqlite.Database("./test.db");

createWindow=()=>{
    const win=new BrowserWindow({
        // height:1800,
        // width:2880,
        fullscreen:true,
        webPreferences:{
            nodeIntegration:true,
        },
        icon:"./assets/images/cash-register.png"
    });
    win.webContents.openDevTools();
    win.loadFile("templates/index.html");

}

// app.whenReady().then(createWindow);

const init=()=>{

    createWindow();
    
    const CHANNEL_NAME=["menu-utama","supplier","barang","pelanggan","pembelian","penjualan"];

    // ===================== MENU UTAMA SERVICE ==================================
    const menuUtamaService="menu-utama";
    const menuUtamaListener=async(ev,data)=>{
        var sql=`SELECT *,ord.id AS id,GROUP_CONCAT(produk.id,',') AS produk_ids FROM 'order' AS ord LEFT JOIN order_barang AS ord_bar ON ord_bar.order_id=ord.id LEFT JOIN jenis_grosir AS grosir ON grosir.id=ord_bar.grosir_id LEFT JOIN produk AS produk ON produk.id=ord_bar.produk_id GROUP BY ord_bar.id ORDER BY ord.id DESC
        `;
        var res;
        console.log(sql);
        db.all(sql,(err,rows)=>{
            if(err)throw err;
            console.log(rows);
            transaksi=Object();
            for(data of rows){
                if(transaksi[data.id] == undefined){
                    transaksi[data.id]={
                        id:data.id,
                        waktu_order:data.waktu_order,
                        total_harga:data.total_harga,
                        barang:[{
                            nama_barang:data.nama ?? data.nama_produk,
                            nama_jenis:data.nama_jenis ?? "satuan",
                            kuantitas:data.kuantitas ?? "Pembelian Manual",
                            sub_total:data.sub_total
                        }]
                    }
                } else {
                    transaksi[data.id].barang.push({
                        nama_barang:data.nama ?? data.nama_produk,
                        nama_jenis:data.nama_jenis ?? "satuan",
                        kuantitas:data.kuantitas ?? "Pembelian Manual",
                        sub_total:data.sub_total
                    })
                }
            }
            belanjaan=Array();
            for(data in transaksi){
                belanjaan.unshift(transaksi[data]);
            }
            ev.returnValue={
                "service":menuUtamaService,
                "bener":false,
                "angka":12,
                "arr":[5,4,2,5,2],
                "data":belanjaan
            }
        });
        
    }
    ipcMain.on(menuUtamaService,menuUtamaListener);

    const semuaBarangService="semua-barang";
    const semuaBarangListener=(ev,data)=>{
        var sql="SELECT id,nama FROM produk";
        if(data != undefined){
            sql+=" WHERE nama LIKE '%"+data.search+"%'"
        }
        db.all(sql,(err,rows)=>{
            if(err)throw err;
            ev.returnValue={
                "data":rows
            }
        });
    }
    ipcMain.on(semuaBarangService,semuaBarangListener);

    const semuaGrosirService="semua-grosir";
    const semuaGrosirListener=(ev,data)=>{
        var sql="SELECT id,nama_jenis FROM jenis_grosir";
        db.all(sql,(err,rows)=>{
            if(err)throw err;
            // rows.unshift({
            //     "id":0,
            //     "nama_jenis":"satuan"
            // })
            ev.returnValue={
                "data":rows
            }
        });
    }
    ipcMain.on(semuaGrosirService,semuaGrosirListener);

    const getHargaService="get-harga";
    const getHargaListener=(ev,data)=>{
        if(data.kuantitas == ''){
            data.kuantitas=0
        }
        if(data.grosirId == 0){
            var sql=`SELECT harga AS harga FROM produk WHERE id=${data.produkId}`;
            db.all(sql,(err,rows)=>{
                if(err)throw err;
                ev.returnValue={
                    data:rows
                }
            })
        } else {
            var sql=`SELECT harga_grosir AS harga FROM produk_grosir WHERE produk_id=${data.produkId} AND jenis_id=${data.grosirId} AND kuantitas<=${data.kuantitas} ORDER BY kuantitas DESC LIMIT 1`;
            db.all(sql,(err,rows)=>{
                if(err)throw err;
                if(rows.length == 0){
                    sql=`SELECT harga AS harga FROM produk WHERE id=${data.produkId}`
                    db.all(sql,(err,rows)=>{
                        if(err)throw err;
                        ev.returnValue={
                            data:rows
                        }
                    })
                } else {
                    ev.returnValue={
                        data:rows
                    }
                }
            })
        }
    }
    ipcMain.on(getHargaService,getHargaListener);


    const buatTransaksiService="transaksi-service";
    const buatTransaksiListener=(ev,data)=>{
        var sql=`INSERT INTO 'order' (total_harga) VALUES (${data.total_harga})`
        db.run(sql,(err)=>{
            if(err)throw err;
            sql=`SELECT last_insert_rowid() AS inserting;`;
            db.all(sql,(err,rows)=>{
                if(err)throw err;
                const orderId=rows[0].inserting;
                var query="";
                for(barang of data.belanja){
                    if(barang.grosirId == 0){
                        barang.grosirId=null
                    }
                    query+=`INSERT INTO order_barang (produk_id,kuantitas,grosir_id,order_id,sub_total,nama_produk) VALUES (${barang.produkId},${barang.kuantitas},${barang.grosirId},${orderId},${barang.subTotal},'${barang.namaProduk}');`
                }
                console.log(query);
                db.exec(query,async function(err){
                    console.log("EXECUTED");
                    if(err)throw err;

                    printer=new ThermalPrinter({
                        type:PrinterTypes.EPSON,
                        interface:"\\.\COM1",
                        characterSet:"SLOVENIA",
                        removeSpecialCharacters:false,
                        lineCharacter:"=",
                        options:{
                            timeout:10000
                        }
                    });

                    // PRINTING
                    printer.isPrinterConnected().then((conn)=>{
                        if(conn){
                            printer.println("Toko Az-Zahra")
                            printer.println("Jalan Raya Semangen")
                            printer.println("Depan SD Wanajaya")
                            printer.println("0822-1464-5888")
                            printer.println("==================")
                            printer.println("STRUK BELANJA")
                            printer.println(Date.now().toString())
                            printer.println("DAFTAR BELANJAAN")
                            for(barang of data.belanja){
                                printer.println(`${barang.produkId} ${barang.kuantitas}x${barang.grosirId} - Rp${barang.subTotal}`)
                            }
                            printer.println("TOTAL HARGA : "+data.total_harga)
                            printer.println("==================")
                            printer.println("Barang yang sudah dibeli")
                            printer.println("Tidak dapat ditukar kembali")
                            printer.println("Terimakasih")
                            printer.execute().then((val)=>{
                                ev.returnValue={
                                    "inserted":true,
                                    "printed":true
                                }
                            }).catch((err)=>{
                                throw err;
                            })
                        } else {
                            console.log("NOT PRINTED")
                            ev.returnValue={
                                "inserted":true,
                                "printed":false
                            }
                        }
                    });
                })
            })
        })
    }
    ipcMain.on(buatTransaksiService,buatTransaksiListener);


    // ===================== SUPPLIER SERVICE ==================================
    const supplierService="supplier";
    const supplierListener=(ev,data)=>{
        var sql="SELECT * FROM supplier";
        if(data.search != undefined){
            sql+=" WHERE nama LIKE '%"+data.search+"%'"
        }
        sql+=" ORDER BY id DESC"
        var res;
        db.all(sql,(err,rows)=>{
            if(err)throw err;
            ev.reply(supplierService,{
                "service":supplierService,
                "bener":false,
                "angka":12,
                "arr":[5,4,2,5,2],
                "data":rows
            });
            ev.returnValue={
                "service":supplierService,
                "bener":false,
                "angka":12,
                "arr":[5,4,2,5,2],
                "data":rows
            }
        });
    }
    ipcMain.on(supplierService,supplierListener);

    const buatSupplierService="buat-supplier";
    const buatSupplierListener=(ev,data)=>{
        console.log(data);
        var sql=`INSERT INTO supplier (nama,alamat,kontak) VALUES('${data.namaSupplier}','${data.alamatSupplier}','${data.kontakSupplier}')`
        db.run(sql,(err,rows)=>{
            if(err)throw err;
            ev.returnValue={
                "service":buatSupplierService,
                "data":rows
            }
        });
    }
    ipcMain.on(buatSupplierService,buatSupplierListener);

    const hapusSupplierService="hapus-supplier";
    const hapusSupplierListener=(ev,data)=>{
        console.log(data);
        var sql="DELETE FROM supplier WHERE id="+data.id;
        db.run(sql,(err,rows)=>{
            if(err)throw err;
            ev.returnValue={
                "service":hapusSupplierService,
                "data":rows
            }
        });
    }
    ipcMain.on(hapusSupplierService,hapusSupplierListener)

    const editUtangPiutangService="edit-utang-piutang";
    const editUtangPiutangListener=(ev,data)=>{
        var sql=`UPDATE supplier SET utang=${data.utang}, piutang=${data.piutang} WHERE id=${data.supplier_id};`
        console.log(sql);
        db.exec(sql,(err)=>{
            if(err)throw err;
            ev.returnValue={
                "updated":true
            }
        });
    }
    ipcMain.on(editUtangPiutangService,editUtangPiutangListener)


    // ===================== BARANG SERVICE ==================================
    const barangService="barang";
    const barangListener=(ev,data)=>{
        var sql="SELECT produk.id AS prod_id,produk.*,grosir.*,jenis.* FROM produk AS produk LEFT JOIN produk_grosir AS grosir ON grosir.produk_id=produk.id LEFT JOIN jenis_grosir AS jenis ON grosir.jenis_id=jenis.id";
        console.log(data);
        if(data.search){
            sql+=" WHERE produk.nama LIKE '%"+data.search+"%' "
        }
        sql+=" ORDER BY produk.nama "
        var res;
        db.all(sql,(err,rows)=>{
            console.log(rows)
            if(err)throw err;
            response=Object();
            for(row of rows){
                // Check apakah nama produk sudah ada di dalam object?
                var jenis=row.nama_jenis
                if(!(row["nama"] in response)){
                    response[row["nama"]]={
                        "id":row["prod_id"],
                        "nama":row["nama"],
                        "deskripsi":row["deskripsi"],
                        "harga":row["harga"],
                        "kode_barang":row["kode_barang"],
                        "harga_beli":row["harga_beli"]
                    }
                    grosir={}
                    grosir[jenis]=[
                        {
                            "kuantitas":row["kuantitas"],
                            "harga_satuan":row["harga_grosir"],
                            "grosir_id":row["jenis_id"],
                            "nama_grosir":row["nama_jenis"]
                        },
                    ]
                    response[row["nama"]]["grosir"]=grosir
                } else {
                    // Check apakah data grosir sudah ada di dalam object?
                    if(!(jenis in response[row["nama"]]["grosir"])){
                        response[row["nama"]]["grosir"][jenis]=[
                            {
                                "kuantitas":row["kuantitas"],
                                "harga_satuan":row["harga_grosir"],
                                "grosir_id":row["jenis_id"],
                                "nama_grosir":row["nama_jenis"]
                            }
                        ]
                    } else {
                        response[row["nama"]]["grosir"][jenis].push(
                            {
                                "kuantitas":row["kuantitas"],
                                "harga_satuan":row["harga_grosir"],
                                "grosir_id":row["jenis_id"],
                                "nama_grosir":row["nama_jenis"]
                            }
                        )
                    }
                }
            }
            products=Array();
            for(product in response){
                products.push(response[product])
            }
            ev.reply(barangService,{
                "service":barangService,
                "bener":false,
                "angka":12,
                "arr":[5,4,2,5,2],
                "data":products
            });
            ev.returnValue={
                "service":barangService,
                "bener":false,
                "angka":12,
                "arr":[5,4,2,5,2],
                "data":products
            }
        });
    }
    ipcMain.on(barangService,barangListener)

    const editBarangService="edit-barang";
    const editBarangListener=(ev,data)=>{
        if(!data.hargaBeliBarang){
            data.hargaBeliBarang=0
        }
        var sql=`UPDATE produk SET nama='${data.namaBarang}',kode_barang='${data.kodeBarang}',harga=${data.hargaSatuan},harga_beli=${data.hargaBeliBarang ?? 0} WHERE id=${parseInt(data.idBarang)}`
        db.exec(sql,err=>{
            if(err)throw err;
            var sql=`DELETE FROM produk_grosir WHERE produk_id=${data.idBarang}`;
            db.exec(sql,err=>{
                if(err)throw err;
                var sql="";
                for(grosirs of data.grosir){
                    var jenisGrosir=grosirs.jenis_id;
                    for(grosir of grosirs.grosir){
                        sql+=`INSERT INTO produk_grosir (produk_id,jenis_id,kuantitas,harga_grosir) VALUES (${data.idBarang},${jenisGrosir},${grosir.kuantitas},${grosir.harga_satuan});`
                    }
                }
                console.log(data.grosirTambahan)
                for(tambahan of data.grosirTambahan){
                    sql+=`INSERT INTO produk_grosir (produk_id,jenis_id,kuantitas,harga_grosir) VALUES (${data.idBarang},${tambahan.jenis},${tambahan.kuantitas},${tambahan.harga});`
                }
                db.exec(sql,err=>{
                    if(err)throw err;
                    ev.returnValue={
                        'updated':true
                    }
                })
            })
        })
        // console.log(sql);
        // ev.returnValue={
        //     'updated':true
        // }
    }
    ipcMain.on(editBarangService,editBarangListener);

    const deleteBarangService=barangService+"-delete"
    deleteBarangListener=(ev,data)=>{
        var sql="DELETE FROM produk WHERE id="+data["id"]
        console.log(sql);
        db.run(sql,(err,rows)=>{
            if(err)throw err;
            ev.returnValue={
                "status":1
            }
        });
    }
    ipcMain.on(deleteBarangService,deleteBarangListener)

    const tambahListBarangService="tambah-list-barang";
    const tambahListBarangListener=(ev,data)=>{
        var sql=`INSERT INTO produk (nama,harga,kode_barang,gambar,deskripsi,harga_beli) VALUES ('${data.namaProduk}',${data.hargaSatuan},'${data.kodeProduk}','','',${data.hargaBeli})`;
        db.run(sql,(err)=>{
            if(err)throw err;
            sql=`SELECT last_insert_rowid() AS inserting;`
            db.all(sql,(err,rows)=>{
                if(err)throw err;
                const produkId=rows[0].inserting;
                sql=""
                for(grosir of data.hargaGrosir){
                    if(grosir.grosirId == 0){
                        grosir.grosirId=1
                    }
                    sql+=`INSERT INTO produk_grosir (jenis_id,produk_id,harga_grosir,kuantitas) VALUES (${grosir.grosirId},${produkId},${grosir.hargaGrosir},${grosir.minimumPembelian});`
                }
                db.exec(sql,(err)=>{
                    if(err)throw err;
                    ev.returnValue={
                        "inserted":true
                    }
                })
            })
        })
    }
    ipcMain.on(tambahListBarangService,tambahListBarangListener)

    // ===================== PELANGGAN SERVICE ==================================
    const pelangganService="pelanggan";
    const pelangganListener=(ev,data)=>{
        var sql="SELECT * FROM pelanggan ORDER BY id DESC";
        var res;
        db.all(sql,(err,rows)=>{
            if(err)throw err;
            ev.reply(pelangganService,{
                "service":pelangganService,
                "bener":false,
                "angka":12,
                "arr":[5,4,2,5,2],
                "data":rows
            });
            ev.returnValue={
                "service":pelangganService,
                "bener":false,
                "angka":12,
                "arr":[5,4,2,5,2],
                "data":rows
            }
        });
    }
    ipcMain.on(pelangganService,pelangganListener);

    const tambahPelangganService="tambah-pelanggan";
    const tambahPelangganListener=(ev,data)=>{
        var sql=`INSERT INTO pelanggan (nama,alamat,kontak) VALUES ('${data.namaPelanggan}','${data.alamatPelanggan}','${data.kontakPelanggan}')`;
        db.exec(sql,(err)=>{
            if(err) throw err;
            ev.returnValue={
                "inserted":true
            }
        });
    }
    ipcMain.on(tambahPelangganService,tambahPelangganListener);

    // ===================== PEMBELIAN SERVICE ==================================
    const pembelianService="pembelian";
    const pembelianListener=(ev,data)=>{
        var sql="SELECT * FROM testing";
        var res;
        db.all(sql,(err,rows)=>{
            if(err)throw err;
            ev.reply(pembelianService,{
                "service":pembelianService,
                "bener":false,
                "angka":12,
                "arr":[5,4,2,5,2],
                "data":rows
            });
            ev.returnValue={
                "service":pembelianService,
                "bener":false,
                "angka":12,
                "arr":[5,4,2,5,2],
                "data":rows
            }
        });
    }
    ipcMain.on(pembelianService,pembelianListener);

    // ===================== PENJUALAN SERVICE ==================================
    const penjualanService="penjualan";
    const penjualanListener=(ev,data)=>{
        var sql="SELECT SUM(total_harga) AS total_hari, strftime('%d-%m-%Y',waktu_order) AS tanggal FROM 'order' AS ord GROUP BY strftime('%d-%m-%Y',waktu_order)";
        var res;
        db.all(sql,(err,rows)=>{
            if(err)throw err;
            tanggal=Array();
            totalPenjualanHari=Array();
            for(elements of rows){
                tanggal.push(elements.tanggal);
                totalPenjualanHari.push(elements.total_hari);
            }
            data={
                "tanggal":tanggal.length > 7 ? tanggal.slice(0,7) : tanggal,
                "total_per_hari":totalPenjualanHari.length > 7 ? totalPenjualanHari.slice(0,7) : totalPenjualanHari
            }
            ev.returnValue={
                "service":penjualanService,
                "bener":false,
                "angka":12,
                "arr":[5,4,2,5,2],
                "data":data
            }
        });
    }
    ipcMain.on(penjualanService,penjualanListener);

    const penjualanDetailService="penjualan-detail";
    const penjualanDetailListener=(ev,data)=>{
        var sql="SELECT produk.*,'order'.*,grosir.*,order_id,produk_id,kuantitas,sub_total,nama_produk AS order_nama_produk FROM order_barang AS order_barang LEFT JOIN produk AS produk ON order_barang.produk_id=produk.id LEFT JOIN 'order' ON order_barang.order_id='order'.id LEFT JOIN jenis_grosir AS grosir ON order_barang.grosir_id=grosir.id ORDER BY 'order'.waktu_order DESC"
        db.all(sql,(err,rows)=>{
            if(rows == undefined){
                console.log(rows)
                ev.returnValue={
                    "data":rows
                }
            } else {
                orderBarang=Array();
            // orderId=0;
            data={};
            var yearState=0;
            var monthState=0;
            var dateState=0;
            var orderIdState=0
            for(barang of rows){
                const date=new Date(barang["waktu_order"])
                const orderYear=date.getFullYear();
                const orderMonth=date.getMonth()+1;
                const orderDate=date.getDate();
                // Inisiasi
                if(orderIdState === 0){
                    // orderId=barang["order_id"];
                    data={
                        "order":[{
                            "total_harga":barang["total_harga"],
                            "order_id":barang["order_id"],
                            "barang":[
                                {
                                    "nama_produk":barang["nama"] != null ? barang["nama"] : barang["order_nama_produk"],
                                    "produk_id":barang["produk_id"],
                                    "kuantitas":barang["kuantitas"] ?? "Pembelian Manual",
                                    "jenis_grosir":barang["nama_jenis"] ??  "Pembelian Manual",
                                    "sub_total":barang["sub_total"]
                                }
                            ],
                        }],
                        "order_tahun":orderYear,
                        "order_bulan":orderMonth,
                        "order_tanggal":orderDate
                    }
                } else {
                    // masih di hari yg sama
                    if(orderYear == yearState && orderMonth == monthState && orderDate == dateState){
                        // dalam order yang sama
                        if(barang["order_id"] == orderIdState){
                            var length=data["order"].length;
                            data["order"][length-1]["barang"].push({
                                "nama_produk":barang["nama"] != null ? barang["nama"] : barang["order_nama_produk"],
                                "produk_id":barang["produk_id"],
                                "kuantitas":barang["kuantitas"] ?? "Pembelian Manual",
                                "jenis_grosir":barang["nama_jenis"] ??  "Pembelian Manual",
                                "sub_total":barang["sub_total"]
                            })

                            // order yang berbeda
                        } else {
                            data["order"].push({
                                "total_harga":barang["total_harga"],
                                "order_id":barang["order_id"],
                                "barang":[{
                                    "nama_produk":barang["nama"] != null ? barang["nama"] : barang["order_nama_produk"],
                                    "produk_id":barang["produk_id"],
                                    "kuantitas":barang["kuantitas"] ?? "Pembelian Manual",
                                    "jenis_grosir":barang["nama_jenis"] ??  "Pembelian Manual",
                                    "sub_total":barang["sub_total"]
                                }]
                            })
                        }
                        // Berbeda hari
                    } else {
                        orderBarang.push(data);
                        data={
                            "order":[{
                                "total_harga":barang["total_harga"],
                                "order_id":barang["order_id"],
                                "barang":[
                                    {
                                        "nama_produk":barang["nama"] != null ? barang["nama"] : barang["order_nama_produk"],
                                        "produk_id":barang["produk_id"],
                                        "kuantitas":barang["kuantitas"] ?? "Pembelian Manual",
                                        "jenis_grosir":barang["nama_jenis"] ??  "Pembelian Manual",
                                        "sub_total":barang["sub_total"]
                                    }
                                ],
                            }],
                            "order_tahun":orderYear,
                            "order_bulan":orderMonth,
                            "order_tanggal":orderDate
                        }
                    }
                }
                yearState=orderYear;
                monthState=orderMonth;
                dateState=orderDate;
                orderIdState=barang["order_id"];
            }
            console.log(orderBarang);
            ev.returnValue={
                "selected":true,
                "data":orderBarang
            }
            }
        })
    }
    ipcMain.on(penjualanDetailService,penjualanDetailListener)
}

app.on("ready",init)