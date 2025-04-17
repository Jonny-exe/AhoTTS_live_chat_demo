
/******************************************************************************/
/*/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/

AhoTTS Multilingual: A Text-To-Speech system for Basque*, Spanish*, Galician',
Catalan^ and English^^, developed by Aholab Signal Processing Laboratory at the
University of the Basque Country (UPV/EHU). Its acoustic engine is based on
hts_engine** and it uses AhoCoder'' as vocoder.
(Read COPYRIGHT_and_LICENSE_code.txt for more details)
--------------------------------------------------------------------------------

*Linguistic processing for Basque and Spanish, Vocoder (Ahocoder) and
integration by Aholab UPV/EHU.

''AhoCoder is an HNM-based vocoder for Statistical Synthesizers
http://aholab.ehu.es/ahocoder/

++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

Copyrights:
	*1997-2015  Aholab Signal Processing Laboratory, University of the Basque
	 Country (UPV/EHU)
    	''2011-2015 Aholab Signal Processing Laboratory, University of the Basque
	  Country (UPV/EHU)

++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

Licenses:
	*GPL-3.0+
	''Modified BSD (Compatible with GNU GPL)

++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

GPL-3.0+
 This program is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.
 .
 This package is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.
 .
 You should have received a copy of the GNU General Public License
 along with this program. If not, see <http://www.gnu.org/licenses/>.
 .
 On Debian systems, the complete text of the GNU General
 Public License version 3 can be found in /usr/share/common-licenses/GPL-3.

//\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\*/
/******************************************************************************/
/*****************************************************************************/
/*                                                                           */
/*                                \m/(-.-)\m/                                */
/*                                                                           */
/*****************************************************************************/
/*
Version  dd/mm/aa  Autor     Proposito de la edicion
-------  --------  --------  -----------------------
1.1.0	 03/05/12  Agustin    Implementación del tts64 version 1.2.0, KVStrList
1.0.0  	 20/01/12  Agustin	  Codificación inicial
*/
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "Socket_Cliente.hpp"
#include "strl.hpp"
#include "string.hpp"
#include "httplib.h"  // Include cpp-httplib header


using namespace std;

// HTTP
int main(int argc, char *argv[]) {
    KVStrList pro("InputFile=input.txt Lang=eu OutputFile=output.wav Speed=100 SocketIP=NULL IP=NULL Port=0 SocketPort=0 SetDur=n");
    StrList files;

    clargs2props(argc, argv, pro, files,
            "InputFile=s Lang={es|eu} OutputFile=s Speed=s SocketIP=s IP=s Port=i SocketPort=i SetDur=b");
    
    httplib::Server svr;
    
    const char *lang = pro.val("Lang");
    const char *inputfile = pro.val("InputFile");
    const char *outputfile = pro.val("OutputFile");
    const char *speed = pro.val("Speed");
    const char *ip=pro.val("IP");
    const char *ip_socket=pro.val("SocketIP");
    const int puerto=pro.ival("Port");
    const int puerto_socket=pro.ival("SocketPort");
    cout << "Puerto: " << puerto << endl;
    cout << "Puerto socket: " << puerto_socket << endl;
    bool setdur=pro.bbval("SetDur");

    if (!strcmp(ip,"NULL")){
        fprintf(stderr,"IP direction is mandatory\n");
        exit (-1);
    }

    if (!strcmp(ip_socket,"NULL")){
        fprintf(stderr,"Socket IP direction is mandatory\n");
        exit (-1);
    }

    if(puerto<1024 || puerto>65535){
        fprintf(stderr,"The port must be between 1024 and 65535 (WellKnown ports are forbidden)\n");
        exit (-1);
    }

    if(puerto_socket<1024 || puerto_socket>65535){
        fprintf(stderr,"The socket port must be between 1024 and 65535 (WellKnown ports are forbidden)\n");
        exit (-1);
    }

    Options op;
    strcpy(op.language,lang);
    strcpy(op.speed,speed);
    op.setdur=setdur;


    cout << "Hello" << endl;
    svr.Get("/hi", [](const httplib::Request &, httplib::Response &res) {
        cout << "Test: this the HI endpon" << endl;
        res.set_content("Hello World!", "text/plain");
    });

    svr.Options(R"(\*)", [](const auto& req, auto& res) {
        res.set_header("Allow", "GET, POST, HEAD, OPTIONS");
    });
    svr.set_error_handler([](const httplib::Request& req, httplib::Response& res) {
        // Set CORS headers
        res.set_header("Access-Control-Allow-Origin", "*"); // Allow all origins
        res.set_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE"); // Allow methods
        res.set_header("Access-Control-Allow-Headers", "Content-Type"); // Allow headers

        // In case of preflight request (OPTIONS), send an empty response
        if (req.method == "OPTIONS") {
            res.set_header("Access-Control-Allow-Origin", "*");
            res.set_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
            res.set_header("Access-Control-Allow-Headers", "Content-Type");
            res.status = 200;  // OPTIONS request should return 200
        }
    });

    svr.Post("/content_receiver",
  [&](const httplib::Request &req, httplib::Response &res, const httplib::ContentReader &content_reader) {

        cout << "Test: inside reciver" << endl;
        res.set_header("Access-Control-Allow-Origin", "*"); // Allow all origins
        res.set_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE"); // Allow methods
        res.set_header("Access-Control-Allow-Headers", "Content-Type"); // Allow headers
        cout << "Post request! " << endl;

      string body;
      content_reader([&](const char *data, size_t data_length) {
        body.append(data, data_length);
        cout << "Text: " << data << endl;

        ClientConnection *cliente = new ClientConnection (op);
        
        int aux;
        cout << "IP socket: " << ip_socket << endl;
        cout << "Port socket: " << puerto_socket << endl;
        aux=cliente->OpenInetConnection(ip_socket,puerto_socket);
        if(aux==-1)
        {
            fprintf(stderr,"Unable to establish server connection\n");
            exit(-1);
        }

        cliente->SendOptions();
        fprintf(stderr,"Sending file to synthesize\n");
        cout << "Data: "<< data << endl;
        cout << "Length: "<< data_length << endl;
        cliente->SendText(data, data_length, cliente->ObtainSSocket());
        
        
        fprintf(stderr,"Receiving synthesized file\n");

        int out_size = 1024 * 10;
        char **outputAudio = (char**) malloc(sizeof (char**));
        *outputAudio = (char*)malloc(out_size * sizeof(char*));
        cout << "First malloc" << endl;
        cliente->ReceiveAudio(outputAudio, &out_size, cliente->ObtainSSocket());
        cout << "This is the output size of the new audio: " << out_size << endl;
        
        cliente->CloseConnection();
        delete (cliente);
        cout << "Sending" << endl;

        res.set_header("Content-Disposition", "attachment; filename=file.txt");
        res.set_header("Content-Type", "audio/wav");
        res.set_header("Content-Length", std::to_string(out_size));  // Set the Content-Length header
        res.set_content(*outputAudio, out_size, "application/octet-stream");

        return true;
      });
    });

    svr.listen(ip, puerto);
    cout << "Bye" << endl;
    cin.get();
}